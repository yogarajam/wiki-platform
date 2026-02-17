import React, { useState, useEffect, useCallback, useRef } from 'react';
import WikiEditor from '../../components/WikiEditor';
import PageTreeSidebar from '../../components/PageTreeSidebar';
import PermissionsModal from '../../components/PermissionsModal/PermissionsModal';
import html2pdf from 'html2pdf.js';
import { wikiPageApi, uploadApi } from '../../services/api';
import './WikiPage.css';

/**
 * WikiPage Component
 * Main page for viewing and editing wiki pages
 * Combines the sidebar tree and editor
 */
const WikiPage = ({ isAdmin }) => {
    const [currentPage, setCurrentPage] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(null);
    const [editedTitle, setEditedTitle] = useState('');
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createParentId, setCreateParentId] = useState(null);
    const [newPageTitle, setNewPageTitle] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [showPermissionsModal, setShowPermissionsModal] = useState(false);
    const [moveTargets, setMoveTargets] = useState([]);
    const [backlinks, setBacklinks] = useState([]);
    const [attachments, setAttachments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(280);
    const isResizing = useRef(false);
    const fileInputRef = React.useRef(null);

    // Sidebar resize handlers
    const handleResizeStart = useCallback((e) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleResizeMove = (moveEvent) => {
            if (!isResizing.current) return;
            const newWidth = Math.min(Math.max(moveEvent.clientX, 180), 600);
            setSidebarWidth(newWidth);
        };

        const handleResizeEnd = () => {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleResizeMove);
            document.removeEventListener('mouseup', handleResizeEnd);
        };

        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
    }, []);

    // Load page data
    const loadPage = useCallback(async (pageId) => {
        if (!pageId) {
            setCurrentPage(null);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            const page = await wikiPageApi.getPageById(pageId);
            setCurrentPage(page);
            setEditedTitle(page.title);

            // Load backlinks and attachments
            try {
                const links = await wikiPageApi.getBacklinks(pageId);
                setBacklinks(links);
            } catch {
                setBacklinks([]);
            }
            try {
                const files = await uploadApi.getAttachments(pageId);
                setAttachments(files);
            } catch {
                setAttachments([]);
            }
        } catch (err) {
            console.error('Error loading page:', err);
            setError('Failed to load page');
            setCurrentPage(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Handle page selection from tree
    const handleSelectPage = useCallback(
        (page) => {
            if (isEditing) {
                const confirmed = window.confirm(
                    'You have unsaved changes. Discard them?'
                );
                if (!confirmed) return;
            }
            setIsEditing(false);
            setEditedContent(null);
            loadPage(page.id);
        },
        [isEditing, loadPage]
    );

    // Handle create page
    const handleCreatePage = useCallback((parentId, isFolder = false) => {
        setCreateParentId(parentId);
        setNewPageTitle('');
        setIsCreatingFolder(isFolder);
        setShowCreateModal(true);
    }, []);

    // Submit new page
    const handleSubmitNewPage = useCallback(async () => {
        if (!newPageTitle.trim()) {
            alert(isCreatingFolder ? 'Please enter a folder name' : 'Please enter a page title');
            return;
        }

        try {
            setIsSaving(true);
            const newPage = await wikiPageApi.createPage({
                title: newPageTitle.trim(),
                content: isCreatingFolder ? null : JSON.stringify({ blocks: [] }),
                parentId: createParentId,
                folder: isCreatingFolder,
            });
            setShowCreateModal(false);
            setRefreshTrigger((prev) => prev + 1);
            loadPage(newPage.id);
            if (!isCreatingFolder) {
                setIsEditing(true);
            }
        } catch (err) {
            console.error('Error creating page:', err);
            alert('Failed to create: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSaving(false);
        }
    }, [newPageTitle, createParentId, isCreatingFolder, loadPage]);

    // Start editing
    const handleStartEdit = useCallback(() => {
        setIsEditing(true);
        setEditedTitle(currentPage?.title || '');
        setEditedContent(currentPage?.content);
    }, [currentPage]);

    // Cancel editing
    const handleCancelEdit = useCallback(() => {
        setIsEditing(false);
        setEditedContent(null);
        setEditedTitle(currentPage?.title || '');
    }, [currentPage]);

    // Save page
    const handleSave = useCallback(async () => {
        if (!currentPage) return;

        try {
            setIsSaving(true);
            setError(null);

            const contentToSave =
                typeof editedContent === 'object'
                    ? JSON.stringify(editedContent)
                    : editedContent || currentPage.content;

            await wikiPageApi.updatePage(currentPage.id, {
                title: editedTitle,
                content: contentToSave,
            });

            setIsEditing(false);
            setRefreshTrigger((prev) => prev + 1);
            await loadPage(currentPage.id);
        } catch (err) {
            console.error('Error saving page:', err);
            setError('Failed to save page');
            alert('Failed to save: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSaving(false);
        }
    }, [currentPage, editedTitle, editedContent, loadPage]);

    // Delete page
    const handleDelete = useCallback(async () => {
        if (!currentPage) return;

        const confirmed = window.confirm(
            `Are you sure you want to delete "${currentPage.title}"? This action cannot be undone.`
        );
        if (!confirmed) return;

        try {
            setIsSaving(true);
            await wikiPageApi.deletePage(currentPage.id);
            setCurrentPage(null);
            setIsEditing(false);
            setRefreshTrigger((prev) => prev + 1);
        } catch (err) {
            console.error('Error deleting page:', err);
            alert('Failed to delete: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSaving(false);
        }
    }, [currentPage]);

    // Open move modal
    const handleOpenMoveModal = useCallback(async () => {
        try {
            const tree = await wikiPageApi.getPageTree();
            setMoveTargets(tree);
            setShowMoveModal(true);
        } catch (err) {
            console.error('Error loading page tree for move:', err);
            alert('Failed to load page tree');
        }
    }, []);

    // Flatten tree for display, excluding current page and its descendants
    const flattenTree = useCallback((nodes, depth = 0, excludeId = null) => {
        const result = [];
        for (const node of nodes) {
            if (node.id === excludeId) continue;
            result.push({ ...node, depth });
            if (node.children && node.children.length > 0) {
                result.push(...flattenTree(node.children, depth + 1, excludeId));
            }
        }
        return result;
    }, []);

    // Execute move
    const handleMovePage = useCallback(async (newParentId) => {
        if (!currentPage) return;

        try {
            setIsSaving(true);
            await wikiPageApi.movePage(currentPage.id, newParentId);
            setShowMoveModal(false);
            setRefreshTrigger((prev) => prev + 1);
            await loadPage(currentPage.id);
        } catch (err) {
            console.error('Error moving page:', err);
            alert('Failed to move: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsSaving(false);
        }
    }, [currentPage, loadPage]);

    // Handle content change in editor
    const handleContentChange = useCallback((data) => {
        setEditedContent(data);
    }, []);

    // Download page as PDF
    const downloadWikiAsPDF = useCallback(async () => {
        const editorWrapper = document.querySelector('.editor-wrapper');
        if (!editorWrapper) return;

        try {
            setIsDownloading(true);

            const filename = currentPage?.title
                ? `${currentPage.title.replace(/[^a-zA-Z0-9\s-]/g, '').trim()}.pdf`
                : 'wiki-document.pdf';

            const opt = {
                margin:       10,
                filename:     filename,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
                pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] },
            };

            await html2pdf().set(opt).from(editorWrapper).save();
        } catch (err) {
            console.error('Error generating PDF:', err);
            alert('Failed to generate PDF: ' + err.message);
        } finally {
            setIsDownloading(false);
        }
    }, [currentPage]);

    // Handle file upload
    const handleFileUpload = useCallback(async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length || !currentPage) return;

        setIsUploading(true);
        try {
            for (const file of files) {
                await uploadApi.uploadFile(
                    file,
                    `pages/${currentPage.id}/attachments`,
                    (progress) => setUploadProgress(progress),
                    currentPage.id
                );
            }
            setUploadProgress(null);
            // Reload attachments
            const updated = await uploadApi.getAttachments(currentPage.id);
            setAttachments(updated);
        } catch (err) {
            console.error('Error uploading file:', err);
            alert('Failed to upload: ' + (err.response?.data?.message || err.message));
        } finally {
            setIsUploading(false);
            setUploadProgress(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [currentPage]);

    // Handle attachment delete
    const handleDeleteAttachment = useCallback(async (attachmentId, filename) => {
        const confirmed = window.confirm(`Delete "${filename}"?`);
        if (!confirmed) return;

        try {
            await uploadApi.deleteAttachment(attachmentId);
            setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
        } catch (err) {
            console.error('Error deleting attachment:', err);
            alert('Failed to delete attachment');
        }
    }, []);

    // Format file size
    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    // Handle wiki link click - navigate to linked page by title/slug
    const handleWikiLinkClick = useCallback(async (pageName) => {
        try {
            // Search for the page by slug (convert title to slug format)
            const slug = pageName.toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            const page = await wikiPageApi.getPageBySlug(slug);
            if (page) {
                setIsEditing(false);
                setEditedContent(null);
                setCurrentPage(page);
                setEditedTitle(page.title);
                try {
                    const links = await wikiPageApi.getBacklinks(page.id);
                    setBacklinks(links);
                } catch {
                    setBacklinks([]);
                }
            }
        } catch (err) {
            // Page not found - offer to create it
            const create = window.confirm(
                `Page "${pageName}" does not exist. Create it?`
            );
            if (create) {
                handleCreatePage(null);
                setNewPageTitle(pageName);
            }
        }
    }, [handleCreatePage]);

    return (
        <div className="wiki-page-container">
            <PageTreeSidebar
                selectedPageId={currentPage?.id}
                onSelectPage={handleSelectPage}
                onCreatePage={handleCreatePage}
                refreshTrigger={refreshTrigger}
                style={{ width: sidebarWidth }}
            />
            <div
                className={`sidebar-resizer ${isResizing.current ? 'resizing' : ''}`}
                onMouseDown={handleResizeStart}
            />

            <main className="wiki-main-content">
                {isLoading ? (
                    <div className="loading-state">
                        <div className="spinner" />
                        <span>Loading page...</span>
                    </div>
                ) : error && !currentPage ? (
                    <div className="error-state">
                        <span>{error}</span>
                    </div>
                ) : currentPage && currentPage.folder ? (
                    // Folder view - no editor
                    <>
                        <header className="page-header">
                            <div className="folder-title-row">
                                <span className="folder-icon-large">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="32"
                                        height="32"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                    </svg>
                                </span>
                                <h1 className="page-title">{currentPage.title}</h1>
                            </div>
                            <div className="page-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleOpenMoveModal}
                                >
                                    Move
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleDelete}
                                >
                                    Delete
                                </button>
                                {isAdmin && (
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => setShowPermissionsModal(true)}
                                    >
                                        Permissions
                                    </button>
                                )}
                            </div>
                        </header>

                        <div className="folder-empty-state">
                            <p>This is a folder. Use it to organize your pages.</p>
                            <div className="folder-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleCreatePage(currentPage.id, false)}
                                >
                                    Create Page Here
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => handleCreatePage(currentPage.id, true)}
                                >
                                    Create Subfolder
                                </button>
                            </div>
                        </div>
                    </>
                ) : currentPage ? (
                    <>
                        <header className="page-header">
                            {isEditing ? (
                                <input
                                    type="text"
                                    className="page-title-input"
                                    value={editedTitle}
                                    onChange={(e) => setEditedTitle(e.target.value)}
                                    placeholder="Page title"
                                />
                            ) : (
                                <h1 className="page-title">{currentPage.title}</h1>
                            )}

                            <div className="page-actions">
                                {isEditing ? (
                                    <>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={handleCancelEdit}
                                            disabled={isSaving}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleSave}
                                            disabled={isSaving}
                                        >
                                            {isSaving ? 'Saving...' : 'Save'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={handleOpenMoveModal}
                                        >
                                            Move
                                        </button>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={handleDelete}
                                        >
                                            Delete
                                        </button>
                                        {isAdmin && (
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => setShowPermissionsModal(true)}
                                            >
                                                Permissions
                                            </button>
                                        )}
                                        <button
                                            id="download-pdf"
                                            className="btn btn-download"
                                            onClick={downloadWikiAsPDF}
                                            disabled={isDownloading}
                                        >
                                            {isDownloading ? 'Generating...' : 'Download PDF'}
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleStartEdit}
                                        >
                                            Edit
                                        </button>
                                    </>
                                )}
                            </div>
                        </header>

                        <div className="page-meta">
                            <span>
                                Last updated:{' '}
                                {new Date(currentPage.updatedAt).toLocaleString()}
                            </span>
                            {currentPage.version > 1 && (
                                <span>Version: {currentPage.version}</span>
                            )}
                        </div>

                        <div className="editor-wrapper">
                            <WikiEditor
                                key={currentPage.id}
                                pageId={currentPage.id}
                                initialContent={currentPage.content}
                                onChange={handleContentChange}
                                onWikiLinkClick={handleWikiLinkClick}
                                readOnly={!isEditing}
                            />
                        </div>

                        {/* Attachments section */}
                        {!isEditing && (
                            <div className="attachments-section">
                                <div className="attachments-header">
                                    <h3>Attachments</h3>
                                    <label className="btn btn-secondary btn-sm upload-btn">
                                        {isUploading ? 'Uploading...' : 'Upload File'}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            onChange={handleFileUpload}
                                            disabled={isUploading}
                                            style={{ display: 'none' }}
                                        />
                                    </label>
                                </div>
                                {uploadProgress !== null && (
                                    <div className="attachment-upload-progress">
                                        <div
                                            className="attachment-progress-bar"
                                            style={{ width: `${uploadProgress}%` }}
                                        />
                                    </div>
                                )}
                                {attachments.length > 0 ? (
                                    <ul className="attachment-list">
                                        {attachments.map((att) => (
                                            <li key={att.id} className="attachment-item">
                                                <a
                                                    href={att.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="attachment-link"
                                                >
                                                    <span className="attachment-icon">
                                                        {att.contentType?.startsWith('image/') ? '\u{1F5BC}' : '\u{1F4CE}'}
                                                    </span>
                                                    <span className="attachment-name">{att.originalFilename}</span>
                                                    <span className="attachment-size">{formatFileSize(att.fileSize)}</span>
                                                </a>
                                                <button
                                                    className="attachment-delete"
                                                    onClick={() => handleDeleteAttachment(att.id, att.originalFilename)}
                                                    title="Delete attachment"
                                                >
                                                    &times;
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="no-attachments">No attachments yet.</p>
                                )}
                            </div>
                        )}

                        {backlinks.length > 0 && !isEditing && (
                            <div className="backlinks-section">
                                <h3>Backlinks</h3>
                                <p>Pages that link to this page:</p>
                                <ul>
                                    {backlinks.map((link) => (
                                        <li key={link.id}>
                                            <button
                                                className="backlink-item"
                                                onClick={() => handleSelectPage(link)}
                                            >
                                                {link.title}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="64"
                                height="64"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                            >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                            </svg>
                        </div>
                        <h2>Select a page</h2>
                        <p>Choose a page from the sidebar or create a new one</p>
                        <button
                            className="btn btn-primary"
                            onClick={() => handleCreatePage(null)}
                        >
                            Create New Page
                        </button>
                    </div>
                )}
            </main>

            {/* Move Page Modal */}
            {showMoveModal && currentPage && (
                <div className="modal-overlay" onClick={() => setShowMoveModal(false)}>
                    <div className="modal move-modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Move "{currentPage.title}"</h2>
                        <p className="move-instruction">Select a destination:</p>
                        <div className="move-tree-list">
                            <div
                                className={`move-tree-item ${!currentPage.parentId ? 'current-location' : ''}`}
                                onClick={() => handleMovePage(null)}
                            >
                                <span className="move-item-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                    </svg>
                                </span>
                                <span className="move-item-title">Root level (no parent)</span>
                                {!currentPage.parentId && <span className="current-badge">current</span>}
                            </div>
                            {flattenTree(moveTargets, 0, currentPage.id).map((node) => (
                                <div
                                    key={node.id}
                                    className={`move-tree-item ${node.id === currentPage.parentId ? 'current-location' : ''}`}
                                    style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
                                    onClick={() => handleMovePage(node.id)}
                                >
                                    <span className="move-item-icon">
                                        {node.folder ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                <polyline points="14 2 14 8 20 8" />
                                            </svg>
                                        )}
                                    </span>
                                    <span className="move-item-title">{node.title}</span>
                                    {node.id === currentPage.parentId && <span className="current-badge">current</span>}
                                </div>
                            ))}
                        </div>
                        <div className="modal-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowMoveModal(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Permissions Modal */}
            {showPermissionsModal && currentPage && (
                <PermissionsModal
                    pageId={currentPage.id}
                    pageTitle={currentPage.title}
                    onClose={() => setShowPermissionsModal(false)}
                />
            )}

            {/* Create Page Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>{isCreatingFolder ? 'Create New Folder' : 'Create New Page'}</h2>
                        <div className="form-group">
                            <label htmlFor="pageTitle">{isCreatingFolder ? 'Folder Name' : 'Page Title'}</label>
                            <input
                                id="pageTitle"
                                type="text"
                                value={newPageTitle}
                                onChange={(e) => setNewPageTitle(e.target.value)}
                                placeholder={isCreatingFolder ? 'Enter folder name...' : 'Enter page title...'}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSubmitNewPage();
                                    if (e.key === 'Escape') setShowCreateModal(false);
                                }}
                            />
                        </div>
                        {createParentId && (
                            <p className="parent-note">
                                This {isCreatingFolder ? 'folder' : 'page'} will be created as a child.
                            </p>
                        )}
                        <div className="modal-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowCreateModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSubmitNewPage}
                                disabled={isSaving || !newPageTitle.trim()}
                            >
                                {isSaving ? 'Creating...' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WikiPage;