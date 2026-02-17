import axios from 'axios';

const API_BASE_URL = '/api';

const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Attach Basic auth header from stored credentials
api.interceptors.request.use((config) => {
    const creds = localStorage.getItem('wiki_auth');
    if (creds) {
        config.headers.Authorization = `Basic ${creds}`;
    }
    return config;
});

// Auth helpers
export const authApi = {
    login: async (username, password) => {
        const encoded = btoa(`${username}:${password}`);
        // Test credentials by calling a protected endpoint
        const response = await axios.get(`${API_BASE_URL}/pages/tree`, {
            headers: { Authorization: `Basic ${encoded}` },
        });
        // If we get here, credentials are valid
        localStorage.setItem('wiki_auth', encoded);
        localStorage.setItem('wiki_user', username);
        return { username };
    },
    logout: () => {
        localStorage.removeItem('wiki_auth');
        localStorage.removeItem('wiki_user');
    },
    isLoggedIn: () => {
        return !!localStorage.getItem('wiki_auth');
    },
    getUsername: () => {
        return localStorage.getItem('wiki_user');
    },
};

// ==================== Wiki Page API ====================

export const wikiPageApi = {
    /**
     * Get all wiki pages as a tree structure
     */
    getPageTree: async () => {
        const response = await api.get('/pages/tree');
        return response.data;
    },

    /**
     * Get a single page by slug
     */
    getPageBySlug: async (slug) => {
        const response = await api.get(`/pages/slug/${slug}`);
        return response.data;
    },

    /**
     * Get a single page by ID
     */
    getPageById: async (id) => {
        const response = await api.get(`/pages/${id}`);
        return response.data;
    },

    /**
     * Create a new page
     */
    createPage: async (pageData) => {
        const response = await api.post('/pages', pageData);
        return response.data;
    },

    /**
     * Update an existing page
     */
    updatePage: async (id, pageData) => {
        const response = await api.put(`/pages/${id}`, pageData);
        return response.data;
    },

    /**
     * Delete a page
     */
    deletePage: async (id) => {
        await api.delete(`/pages/${id}`);
    },

    /**
     * Move a page to a new parent
     */
    movePage: async (pageId, newParentId) => {
        const response = await api.put(`/pages/${pageId}/move`, { parentId: newParentId });
        return response.data;
    },

    /**
     * Get backlinks for a page
     */
    getBacklinks: async (pageId) => {
        const response = await api.get(`/pages/${pageId}/backlinks`);
        return response.data;
    },

    /**
     * Search pages
     */
    searchPages: async (query) => {
        const response = await api.get('/pages/search', { params: { q: query } });
        return response.data;
    },
};

// ==================== File Upload API ====================

export const uploadApi = {
    /**
     * Upload a file to MinIO storage
     * @param {File} file - The file to upload
     * @param {string} pathPrefix - Optional path prefix (e.g., 'pages/123')
     * @param {function} onProgress - Progress callback
     * @param {number} pageId - Optional page ID to link attachment to
     * @returns {Promise<{url: string, objectKey: string}>}
     */
    uploadFile: async (file, pathPrefix = '', onProgress = null, pageId = null) => {
        const formData = new FormData();
        formData.append('file', file);
        if (pathPrefix) {
            formData.append('pathPrefix', pathPrefix);
        }
        if (pageId) {
            formData.append('pageId', pageId);
        }

        const response = await api.post('/attachments/upload', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
                if (onProgress) {
                    const percentCompleted = Math.round(
                        (progressEvent.loaded * 100) / progressEvent.total
                    );
                    onProgress(percentCompleted);
                }
            },
        });

        return response.data;
    },

    /**
     * Upload an image specifically for the editor
     * Returns the format expected by Editor.js Image tool
     */
    uploadImage: async (file, pageId = null) => {
        const pathPrefix = pageId ? `pages/${pageId}/images` : 'images';
        const result = await uploadApi.uploadFile(file, pathPrefix);

        return {
            success: 1,
            file: {
                url: result.url,
                objectKey: result.objectKey,
            },
        };
    },

    /**
     * Get all attachments for a page
     */
    getAttachments: async (pageId) => {
        const response = await api.get(`/attachments/page/${pageId}`);
        return response.data;
    },

    /**
     * Delete an attachment
     */
    deleteAttachment: async (attachmentId) => {
        await api.delete(`/attachments/${attachmentId}`);
    },
};

// ==================== Admin API ====================

export const adminApi = {
    getMe: async () => {
        const response = await api.get('/admin/me');
        return response.data;
    },
    getUsers: async () => {
        const response = await api.get('/admin/users');
        return response.data;
    },
    getRoles: async () => {
        const response = await api.get('/admin/roles');
        return response.data;
    },
};

// ==================== Permission API ====================

export const permissionApi = {
    getPagePermissions: async (pageId) => {
        const response = await api.get(`/permissions/page/${pageId}`);
        return response.data;
    },
    grantUserPermission: async (pageId, userId, permissionType) => {
        const response = await api.post(`/permissions/page/${pageId}/user/${userId}`, { permissionType });
        return response.data;
    },
    grantRolePermission: async (pageId, roleId, permissionType) => {
        const response = await api.post(`/permissions/page/${pageId}/role/${roleId}`, { permissionType });
        return response.data;
    },
    revokeUserPermission: async (pageId, userId, permissionType) => {
        await api.delete(`/permissions/page/${pageId}/user/${userId}`, { params: { permissionType } });
    },
    revokeRolePermission: async (pageId, roleId, permissionType) => {
        await api.delete(`/permissions/page/${pageId}/role/${roleId}`, { params: { permissionType } });
    },
    revokeAllPermissions: async (pageId) => {
        await api.delete(`/permissions/page/${pageId}`);
    },
    isSensitive: async (pageId) => {
        const response = await api.get(`/permissions/page/${pageId}/sensitive`);
        return response.data;
    },
    markSensitive: async (pageId) => {
        const response = await api.post(`/permissions/page/${pageId}/sensitive`);
        return response.data;
    },
    markPublic: async (pageId) => {
        const response = await api.post(`/permissions/page/${pageId}/public`);
        return response.data;
    },
    getSensitivePages: async () => {
        const response = await api.get('/permissions/sensitive-pages');
        return response.data;
    },
};

// ==================== Search Admin API ====================

export const searchAdminApi = {
    getStats: async () => {
        const response = await api.get('/search/stats');
        return response.data;
    },
    reindexAll: async () => {
        const response = await api.post('/search/reindex');
        return response.data;
    },
    reindexPage: async (pageId) => {
        const response = await api.post(`/search/reindex/page/${pageId}`);
        return response.data;
    },
};

export default api;