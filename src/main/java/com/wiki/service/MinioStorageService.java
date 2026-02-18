package com.wiki.service;

import com.wiki.exception.StorageException;
import com.wiki.exception.StorageException.ErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Service for uploading files to MinIO using AWS SDK v2
 * Supports multipart uploads for large files with comprehensive error handling
 */
@Service
public class MinioStorageService {

    private static final Logger log = LoggerFactory.getLogger(MinioStorageService.class);

    // 5MB minimum part size for multipart upload (AWS requirement)
    private static final long MIN_PART_SIZE = 5 * 1024 * 1024;

    // Threshold for using multipart upload (10MB)
    private static final long MULTIPART_THRESHOLD = 10 * 1024 * 1024;

    private final S3Client s3Client;

    @Value("${minio.bucket:wiki-attachments}")
    private String bucketName;

    @Value("${minio.max-retries:3}")
    private int maxRetries;

    @Value("${minio.public-url:#{null}}")
    private String publicUrl;

    public MinioStorageService(S3Client s3Client) {
        this.s3Client = s3Client;
    }

    /**
     * Upload a multipart file to MinIO
     * Uses simple upload for small files, multipart upload for large files
     *
     * @param file the multipart file to upload
     * @return the object key (path) of the uploaded file
     */
    public String uploadFile(MultipartFile file) {
        return uploadFile(file, null);
    }

    /**
     * Upload a multipart file to MinIO with a custom path prefix
     *
     * @param file       the multipart file to upload
     * @param pathPrefix optional path prefix (e.g., "wiki-pages/123/")
     * @return the object key (path) of the uploaded file
     */
    public String uploadFile(MultipartFile file, String pathPrefix) {
        validateFile(file);
        ensureBucketExists();

        String objectKey = generateObjectKey(file.getOriginalFilename(), pathPrefix);
        long fileSize = file.getSize();

        log.info("Uploading file: {} ({} bytes) to bucket: {}",
                objectKey, fileSize, bucketName);

        try {
            if (fileSize >= MULTIPART_THRESHOLD) {
                return uploadMultipart(file, objectKey);
            } else {
                return uploadSimple(file, objectKey);
            }
        } catch (SdkClientException e) {
            throw handleS3Exception(e, "uploading file: " + objectKey);
        } catch (IOException e) {
            throw new StorageException(ErrorCode.UPLOAD_FAILED,
                    "Failed to read file: " + file.getOriginalFilename(), e);
        }
    }

    /**
     * Simple upload for files smaller than the multipart threshold
     */
    private String uploadSimple(MultipartFile file, String objectKey) throws IOException {
        int retries = 0;
        while (retries < maxRetries) {
            try {
                PutObjectRequest request = PutObjectRequest.builder()
                        .bucket(bucketName)
                        .key(objectKey)
                        .contentType(file.getContentType())
                        .contentLength(file.getSize())
                        .build();

                s3Client.putObject(request, RequestBody.fromInputStream(
                        file.getInputStream(), file.getSize()));

                log.info("Successfully uploaded file: {}", objectKey);
                return objectKey;

            } catch (SdkClientException e) {
                retries++;
                if (isConnectionError(e) && retries < maxRetries) {
                    log.warn("Upload attempt {} failed, retrying... Error: {}",
                            retries, e.getMessage());
                    waitBeforeRetry(retries);
                } else {
                    throw e;
                }
            }
        }
        throw new StorageException(ErrorCode.UPLOAD_FAILED,
                "Max retries exceeded for file: " + objectKey);
    }

    /**
     * Multipart upload for large files
     * Splits file into parts and uploads them separately
     */
    private String uploadMultipart(MultipartFile file, String objectKey) throws IOException {
        String uploadId = null;
        List<CompletedPart> completedParts = new ArrayList<>();

        try {
            // Initiate multipart upload
            CreateMultipartUploadRequest createRequest = CreateMultipartUploadRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .contentType(file.getContentType())
                    .build();

            CreateMultipartUploadResponse createResponse = executeWithRetry(() ->
                    s3Client.createMultipartUpload(createRequest));
            uploadId = createResponse.uploadId();

            log.info("Initiated multipart upload with ID: {}", uploadId);

            // Upload parts
            long fileSize = file.getSize();
            long partSize = calculatePartSize(fileSize);
            int partNumber = 1;
            long position = 0;

            try (InputStream inputStream = file.getInputStream()) {
                while (position < fileSize) {
                    long bytesToRead = Math.min(partSize, fileSize - position);
                    byte[] buffer = new byte[(int) bytesToRead];
                    int bytesRead = inputStream.read(buffer);

                    if (bytesRead <= 0) break;

                    final int currentPartNumber = partNumber;
                    final String currentUploadId = uploadId;

                    UploadPartRequest uploadPartRequest = UploadPartRequest.builder()
                            .bucket(bucketName)
                            .key(objectKey)
                            .uploadId(currentUploadId)
                            .partNumber(currentPartNumber)
                            .contentLength((long) bytesRead)
                            .build();

                    UploadPartResponse uploadPartResponse = executeWithRetry(() ->
                            s3Client.uploadPart(uploadPartRequest,
                                    RequestBody.fromBytes(buffer)));

                    CompletedPart completedPart = CompletedPart.builder()
                            .partNumber(currentPartNumber)
                            .eTag(uploadPartResponse.eTag())
                            .build();
                    completedParts.add(completedPart);

                    log.debug("Uploaded part {} of multipart upload", currentPartNumber);

                    partNumber++;
                    position += bytesRead;
                }
            }

            // Complete multipart upload
            CompletedMultipartUpload completedUpload = CompletedMultipartUpload.builder()
                    .parts(completedParts)
                    .build();

            CompleteMultipartUploadRequest completeRequest = CompleteMultipartUploadRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .uploadId(uploadId)
                    .multipartUpload(completedUpload)
                    .build();

            final String finalUploadId = uploadId;
            executeWithRetry(() -> s3Client.completeMultipartUpload(completeRequest));

            log.info("Successfully completed multipart upload: {}", objectKey);
            return objectKey;

        } catch (Exception e) {
            // Abort multipart upload on failure
            if (uploadId != null) {
                abortMultipartUpload(objectKey, uploadId);
            }
            if (e instanceof StorageException) {
                throw e;
            }
            throw handleS3Exception(e, "multipart upload for file: " + objectKey);
        }
    }

    /**
     * Abort a multipart upload that failed
     */
    private void abortMultipartUpload(String objectKey, String uploadId) {
        try {
            AbortMultipartUploadRequest abortRequest = AbortMultipartUploadRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .uploadId(uploadId)
                    .build();
            s3Client.abortMultipartUpload(abortRequest);
            log.warn("Aborted multipart upload: {} (uploadId: {})", objectKey, uploadId);
        } catch (Exception e) {
            log.error("Failed to abort multipart upload: {} (uploadId: {})",
                    objectKey, uploadId, e);
        }
    }

    /**
     * Delete a file from MinIO
     */
    public void deleteFile(String objectKey) {
        try {
            DeleteObjectRequest request = DeleteObjectRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .build();

            executeWithRetry(() -> {
                s3Client.deleteObject(request);
                return null;
            });

            log.info("Deleted file: {}", objectKey);

        } catch (SdkClientException e) {
            throw handleS3Exception(e, "deleting file: " + objectKey);
        }
    }

    /**
     * Check if a file exists in MinIO
     */
    public boolean fileExists(String objectKey) {
        try {
            HeadObjectRequest request = HeadObjectRequest.builder()
                    .bucket(bucketName)
                    .key(objectKey)
                    .build();

            s3Client.headObject(request);
            return true;

        } catch (NoSuchKeyException e) {
            return false;
        } catch (SdkClientException e) {
            throw handleS3Exception(e, "checking file existence: " + objectKey);
        }
    }

    /**
     * Get the URL for accessing a file.
     * Uses minio.public-url if configured (for Docker where internal endpoint differs from browser-accessible URL).
     */
    public String getFileUrl(String objectKey) {
        String baseUrl = publicUrl != null ? publicUrl :
                s3Client.serviceClientConfiguration().endpointOverride()
                        .map(Object::toString).orElse("");
        return String.format("%s/%s/%s", baseUrl, bucketName, objectKey);
    }

    /**
     * Get a presigned URL for temporary access to a file
     *
     * @param objectKey     the object key
     * @param expirationSeconds how long the URL should be valid
     * @return presigned URL
     */
    public String getPresignedUrl(String objectKey, int expirationSeconds) {
        // For MinIO with public bucket access, we can just return the direct URL
        // If you need actual presigned URLs, you would need to use S3Presigner
        return getFileUrl(objectKey);
    }

    /**
     * Ensure the bucket exists, create if it doesn't
     */
    private void ensureBucketExists() {
        try {
            HeadBucketRequest headRequest = HeadBucketRequest.builder()
                    .bucket(bucketName)
                    .build();
            s3Client.headBucket(headRequest);

        } catch (NoSuchBucketException e) {
            log.info("Bucket {} does not exist, creating...", bucketName);
            try {
                CreateBucketRequest createRequest = CreateBucketRequest.builder()
                        .bucket(bucketName)
                        .build();
                s3Client.createBucket(createRequest);
                log.info("Created bucket: {}", bucketName);
            } catch (SdkClientException ex) {
                throw handleS3Exception(ex, "creating bucket: " + bucketName);
            }
        } catch (SdkClientException e) {
            throw handleS3Exception(e, "checking bucket: " + bucketName);
        }
    }

    /**
     * Validate the uploaded file
     */
    private void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new StorageException(ErrorCode.INVALID_FILE, "File is empty or null");
        }
        if (file.getOriginalFilename() == null || file.getOriginalFilename().isBlank()) {
            throw new StorageException(ErrorCode.INVALID_FILE, "File name is missing");
        }
    }

    /**
     * Generate a unique object key for the file
     */
    private String generateObjectKey(String originalFilename, String pathPrefix) {
        String timestamp = String.valueOf(Instant.now().toEpochMilli());
        String uuid = UUID.randomUUID().toString().substring(0, 8);
        String sanitizedFilename = sanitizeFilename(originalFilename);

        String key = timestamp + "-" + uuid + "-" + sanitizedFilename;
        if (pathPrefix != null && !pathPrefix.isBlank()) {
            key = pathPrefix.endsWith("/") ? pathPrefix + key : pathPrefix + "/" + key;
        }
        return key;
    }

    /**
     * Sanitize filename to remove potentially dangerous characters
     */
    private String sanitizeFilename(String filename) {
        return filename.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    /**
     * Calculate optimal part size for multipart upload
     */
    private long calculatePartSize(long fileSize) {
        // AWS allows max 10,000 parts
        long partSize = fileSize / 10000 + 1;
        return Math.max(partSize, MIN_PART_SIZE);
    }

    /**
     * Execute an operation with retry logic
     */
    private <T> T executeWithRetry(SupplierWithException<T> operation) {
        int retries = 0;
        while (retries < maxRetries) {
            try {
                return operation.get();
            } catch (SdkClientException e) {
                retries++;
                if (isConnectionError(e) && retries < maxRetries) {
                    log.warn("Operation attempt {} failed, retrying... Error: {}",
                            retries, e.getMessage());
                    waitBeforeRetry(retries);
                } else {
                    throw e;
                }
            }
        }
        throw new StorageException(ErrorCode.SERVER_UNAVAILABLE,
                "Max retries exceeded");
    }

    /**
     * Check if the exception is a connection-related error
     */
    private boolean isConnectionError(Exception e) {
        Throwable cause = e.getCause();
        while (cause != null) {
            if (cause instanceof ConnectException ||
                cause instanceof java.net.SocketTimeoutException ||
                cause instanceof java.net.UnknownHostException) {
                return true;
            }
            cause = cause.getCause();
        }
        return false;
    }

    /**
     * Wait before retrying with exponential backoff
     */
    private void waitBeforeRetry(int retryCount) {
        try {
            long waitTime = (long) Math.pow(2, retryCount) * 1000; // Exponential backoff
            Thread.sleep(Math.min(waitTime, 10000)); // Max 10 seconds
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Handle S3 exceptions and convert to StorageException
     */
    private StorageException handleS3Exception(Exception e, String context) {
        log.error("S3 operation failed while {}: {}", context, e.getMessage());

        if (isConnectionError(e)) {
            return new StorageException(ErrorCode.SERVER_UNAVAILABLE,
                    "MinIO server is not available", e);
        }

        if (e instanceof NoSuchBucketException) {
            return new StorageException(ErrorCode.BUCKET_NOT_FOUND, bucketName, e);
        }

        if (e instanceof NoSuchKeyException) {
            return new StorageException(ErrorCode.FILE_NOT_FOUND, context, e);
        }

        return new StorageException(ErrorCode.UPLOAD_FAILED, context, e);
    }

    @FunctionalInterface
    private interface SupplierWithException<T> {
        T get() throws SdkClientException;
    }
}