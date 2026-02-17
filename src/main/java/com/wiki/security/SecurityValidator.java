package com.wiki.security;

import com.wiki.model.PagePermission;
import com.wiki.model.PagePermission.PermissionType;
import com.wiki.model.Role;
import com.wiki.model.User;
import com.wiki.model.WikiPage;
import com.wiki.repository.PagePermissionRepository;
import com.wiki.repository.UserRepository;
import com.wiki.repository.WikiPageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Security Validator for page-level access control.
 * Ensures only authorized users can view, edit, or delete sensitive wiki pages.
 */
@Component("securityValidator")
@RequiredArgsConstructor
@Slf4j
public class SecurityValidator {

    private final PagePermissionRepository permissionRepository;
    private final WikiPageRepository wikiPageRepository;
    private final UserRepository userRepository;

    // Permission types that grant edit access
    private static final Set<PermissionType> EDIT_PERMISSIONS = EnumSet.of(
            PermissionType.EDIT,
            PermissionType.FULL_ACCESS
    );

    // Permission types that grant view access
    private static final Set<PermissionType> VIEW_PERMISSIONS = EnumSet.of(
            PermissionType.VIEW,
            PermissionType.EDIT,
            PermissionType.FULL_ACCESS
    );

    // Permission types that grant delete access
    private static final Set<PermissionType> DELETE_PERMISSIONS = EnumSet.of(
            PermissionType.DELETE,
            PermissionType.FULL_ACCESS
    );

    // Permission types that grant manage permissions access
    private static final Set<PermissionType> MANAGE_PERMISSIONS = EnumSet.of(
            PermissionType.MANAGE_PERMISSIONS,
            PermissionType.FULL_ACCESS
    );

    // ==================== Public Validation Methods ====================

    /**
     * Check if current user can view a page.
     *
     * @param pageId the wiki page ID
     * @return true if user can view the page
     */
    @Transactional(readOnly = true)
    public boolean canView(Long pageId) {
        return hasPermission(pageId, VIEW_PERMISSIONS);
    }

    /**
     * Check if current user can edit a page.
     *
     * @param pageId the wiki page ID
     * @return true if user can edit the page
     */
    @Transactional(readOnly = true)
    public boolean canEdit(Long pageId) {
        return hasPermission(pageId, EDIT_PERMISSIONS);
    }

    /**
     * Check if current user can delete a page.
     *
     * @param pageId the wiki page ID
     * @return true if user can delete the page
     */
    @Transactional(readOnly = true)
    public boolean canDelete(Long pageId) {
        return hasPermission(pageId, DELETE_PERMISSIONS);
    }

    /**
     * Check if current user can manage permissions for a page.
     *
     * @param pageId the wiki page ID
     * @return true if user can manage permissions
     */
    @Transactional(readOnly = true)
    public boolean canManagePermissions(Long pageId) {
        return hasPermission(pageId, MANAGE_PERMISSIONS);
    }

    /**
     * Validate that current user can view a page.
     * Throws AccessDeniedException if not authorized.
     *
     * @param pageId the wiki page ID
     */
    @Transactional(readOnly = true)
    public void validateCanView(Long pageId) {
        if (!canView(pageId)) {
            log.warn("Access denied: User cannot view page {}", pageId);
            throw new AccessDeniedException("You do not have permission to view this page");
        }
    }

    /**
     * Validate that current user can edit a page.
     * Throws AccessDeniedException if not authorized.
     *
     * @param pageId the wiki page ID
     */
    @Transactional(readOnly = true)
    public void validateCanEdit(Long pageId) {
        if (!canEdit(pageId)) {
            log.warn("Access denied: User cannot edit page {}", pageId);
            throw new AccessDeniedException("You do not have permission to edit this page");
        }
    }

    /**
     * Validate that current user can delete a page.
     * Throws AccessDeniedException if not authorized.
     *
     * @param pageId the wiki page ID
     */
    @Transactional(readOnly = true)
    public void validateCanDelete(Long pageId) {
        if (!canDelete(pageId)) {
            log.warn("Access denied: User cannot delete page {}", pageId);
            throw new AccessDeniedException("You do not have permission to delete this page");
        }
    }

    // ==================== Core Permission Logic ====================

    /**
     * Check if current user has any of the specified permissions on a page.
     *
     * @param pageId          the wiki page ID
     * @param requiredPermissions set of permission types that would grant access
     * @return true if user has at least one of the required permissions
     */
    @Transactional(readOnly = true)
    public boolean hasPermission(Long pageId, Set<PermissionType> requiredPermissions) {
        // Get current authentication
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            log.debug("No authenticated user for page {} permission check", pageId);
            return false;
        }

        // Get the current user
        String username = auth.getName();
        Optional<User> userOpt = userRepository.findByUsernameWithRoles(username);

        if (userOpt.isEmpty()) {
            log.debug("User {} not found for permission check", username);
            return false;
        }

        User user = userOpt.get();

        // Admins always have access
        if (user.isAdmin()) {
            log.debug("Admin user {} granted access to page {}", username, pageId);
            return true;
        }

        // Check if page exists
        if (!wikiPageRepository.existsById(pageId)) {
            log.debug("Page {} does not exist", pageId);
            return false;
        }

        // Check if page has explicit permissions set (is sensitive)
        long permissionCount = permissionRepository.countByWikiPageId(pageId);

        if (permissionCount == 0) {
            // No explicit permissions set - page is public
            // Allow editors to edit, viewers can only view
            return checkDefaultPermission(user, requiredPermissions);
        }

        // Page has explicit permissions - check them
        return checkExplicitPermissions(pageId, user, requiredPermissions);
    }

    /**
     * Check default permissions based on user roles when no explicit page permissions exist.
     */
    private boolean checkDefaultPermission(User user, Set<PermissionType> requiredPermissions) {
        // Editors can view and edit by default
        if (user.hasRole(Role.EDITOR)) {
            if (requiredPermissions.contains(PermissionType.VIEW) || requiredPermissions.contains(PermissionType.EDIT)) {
                return true;
            }
        }

        // Viewers can only view by default
        if (user.hasRole(Role.VIEWER)) {
            if (requiredPermissions.contains(PermissionType.VIEW)) {
                return true;
            }
        }

        // For delete and manage permissions, only admins (already checked above) have access
        return false;
    }

    /**
     * Check explicit page permissions for a user.
     */
    private boolean checkExplicitPermissions(Long pageId, User user, Set<PermissionType> requiredPermissions) {
        // Check user-specific permissions first
        boolean hasUserPermission = permissionRepository.hasUserPermission(
                pageId, user.getId(), requiredPermissions);

        if (hasUserPermission) {
            log.debug("User {} has explicit permission on page {}", user.getUsername(), pageId);
            return true;
        }

        // Check role-based permissions
        Set<Long> userRoleIds = user.getRoles().stream()
                .map(Role::getId)
                .collect(Collectors.toSet());

        if (!userRoleIds.isEmpty()) {
            boolean hasRolePermission = permissionRepository.hasRolePermission(
                    pageId, userRoleIds, requiredPermissions);

            if (hasRolePermission) {
                log.debug("User {} has role permission on page {}", user.getUsername(), pageId);
                return true;
            }
        }

        log.debug("User {} denied access to page {} - no matching permissions",
                user.getUsername(), pageId);
        return false;
    }

    // ==================== Utility Methods ====================

    /**
     * Get the current authenticated user.
     *
     * @return the current user or empty if not authenticated
     */
    @Transactional(readOnly = true)
    public Optional<User> getCurrentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getName())) {
            return Optional.empty();
        }
        return userRepository.findByUsernameWithRoles(auth.getName());
    }

    /**
     * Check if current user is authenticated.
     */
    public boolean isAuthenticated() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName());
    }

    /**
     * Check if current user is an administrator.
     */
    @Transactional(readOnly = true)
    public boolean isAdmin() {
        return getCurrentUser().map(User::isAdmin).orElse(false);
    }

    /**
     * Check if a page has any explicit permissions set (is considered sensitive).
     *
     * @param pageId the wiki page ID
     * @return true if page has explicit permissions
     */
    @Transactional(readOnly = true)
    public boolean isSensitivePage(Long pageId) {
        return permissionRepository.countByWikiPageId(pageId) > 0;
    }

    /**
     * Get all page IDs that have explicit permissions (sensitive pages).
     *
     * @return set of sensitive page IDs
     */
    @Transactional(readOnly = true)
    public Set<Long> getSensitivePageIds() {
        return permissionRepository.findPagesWithPermissions();
    }
}