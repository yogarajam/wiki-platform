package com.wiki.security;

import com.wiki.model.PagePermission;
import com.wiki.model.PagePermission.PermissionType;
import com.wiki.model.Role;
import com.wiki.model.User;
import com.wiki.model.WikiPage;
import com.wiki.repository.PagePermissionRepository;
import com.wiki.repository.UserRepository;
import com.wiki.repository.WikiPageRepository;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SecurityValidator
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("Security Validator Tests")
class SecurityValidatorTest {

    @Mock
    private PagePermissionRepository permissionRepository;

    @Mock
    private WikiPageRepository wikiPageRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private SecurityContext securityContext;

    @Mock
    private Authentication authentication;

    @InjectMocks
    private SecurityValidator securityValidator;

    private User adminUser;
    private User editorUser;
    private User viewerUser;
    private Role adminRole;
    private Role editorRole;
    private Role viewerRole;
    private WikiPage testPage;

    @BeforeEach
    void setUp() {
        // Set up roles
        adminRole = Role.builder().id(1L).name(Role.ADMIN).build();
        editorRole = Role.builder().id(2L).name(Role.EDITOR).build();
        viewerRole = Role.builder().id(3L).name(Role.VIEWER).build();

        // Set up users
        adminUser = User.builder()
                .id(1L)
                .username("admin")
                .roles(Set.of(adminRole))
                .enabled(true)
                .build();

        editorUser = User.builder()
                .id(2L)
                .username("editor")
                .roles(Set.of(editorRole))
                .enabled(true)
                .build();

        viewerUser = User.builder()
                .id(3L)
                .username("viewer")
                .roles(Set.of(viewerRole))
                .enabled(true)
                .build();

        // Set up test page
        testPage = WikiPage.builder()
                .id(100L)
                .title("Test Page")
                .slug("test-page")
                .build();

        // Set up security context
        SecurityContextHolder.setContext(securityContext);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    // ==================== Admin Access Tests ====================

    @Nested
    @DisplayName("Admin Access Tests")
    class AdminAccessTests {

        @Test
        @DisplayName("Admin should have view access to any page")
        void adminShouldHaveViewAccess() {
            setupAuthentication(adminUser);

            boolean canView = securityValidator.canView(100L);

            assertThat(canView).isTrue();
        }

        @Test
        @DisplayName("Admin should have edit access to any page")
        void adminShouldHaveEditAccess() {
            setupAuthentication(adminUser);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isTrue();
        }

        @Test
        @DisplayName("Admin should have delete access to any page")
        void adminShouldHaveDeleteAccess() {
            setupAuthentication(adminUser);

            boolean canDelete = securityValidator.canDelete(100L);

            assertThat(canDelete).isTrue();
        }

        @Test
        @DisplayName("Admin should have access to sensitive pages")
        void adminShouldHaveAccessToSensitivePages() {
            setupAuthentication(adminUser);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isTrue();
        }
    }

    // ==================== Editor Access Tests ====================

    @Nested
    @DisplayName("Editor Access Tests")
    class EditorAccessTests {

        @Test
        @DisplayName("Editor should have view access to public pages")
        void editorShouldHaveViewAccessToPublicPages() {
            setupAuthentication(editorUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean canView = securityValidator.canView(100L);

            assertThat(canView).isTrue();
        }

        @Test
        @DisplayName("Editor should have edit access to public pages")
        void editorShouldHaveEditAccessToPublicPages() {
            setupAuthentication(editorUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isTrue();
        }

        @Test
        @DisplayName("Editor should not have delete access by default")
        void editorShouldNotHaveDeleteAccessByDefault() {
            setupAuthentication(editorUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean canDelete = securityValidator.canDelete(100L);

            assertThat(canDelete).isFalse();
        }

        @Test
        @DisplayName("Editor should not have access to sensitive pages without permission")
        void editorShouldNotAccessSensitivePagesWithoutPermission() {
            setupAuthentication(editorUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            // Page has explicit permissions (is sensitive)
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(1L);
            // No user permission
            when(permissionRepository.hasUserPermission(eq(100L), eq(2L), any())).thenReturn(false);
            // No role permission
            when(permissionRepository.hasRolePermission(eq(100L), anySet(), any())).thenReturn(false);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isFalse();
        }

        @Test
        @DisplayName("Editor should have access to sensitive pages with explicit permission")
        void editorShouldAccessSensitivePagesWithPermission() {
            setupAuthentication(editorUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            // Page has explicit permissions (is sensitive)
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(1L);
            // User has explicit edit permission
            when(permissionRepository.hasUserPermission(eq(100L), eq(2L), any())).thenReturn(true);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isTrue();
        }
    }

    // ==================== Viewer Access Tests ====================

    @Nested
    @DisplayName("Viewer Access Tests")
    class ViewerAccessTests {

        @Test
        @DisplayName("Viewer should have view access to public pages")
        void viewerShouldHaveViewAccessToPublicPages() {
            setupAuthentication(viewerUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean canView = securityValidator.canView(100L);

            assertThat(canView).isTrue();
        }

        @Test
        @DisplayName("Viewer should not have edit access to public pages")
        void viewerShouldNotHaveEditAccessToPublicPages() {
            setupAuthentication(viewerUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isFalse();
        }

        @Test
        @DisplayName("Viewer should not have delete access")
        void viewerShouldNotHaveDeleteAccess() {
            setupAuthentication(viewerUser);
            when(wikiPageRepository.existsById(100L)).thenReturn(true);
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean canDelete = securityValidator.canDelete(100L);

            assertThat(canDelete).isFalse();
        }
    }

    // ==================== Unauthenticated Access Tests ====================

    @Nested
    @DisplayName("Unauthenticated Access Tests")
    class UnauthenticatedAccessTests {

        @Test
        @DisplayName("Unauthenticated user should not have view access")
        void unauthenticatedShouldNotHaveViewAccess() {
            when(securityContext.getAuthentication()).thenReturn(null);

            boolean canView = securityValidator.canView(100L);

            assertThat(canView).isFalse();
        }

        @Test
        @DisplayName("Unauthenticated user should not have edit access")
        void unauthenticatedShouldNotHaveEditAccess() {
            when(securityContext.getAuthentication()).thenReturn(null);

            boolean canEdit = securityValidator.canEdit(100L);

            assertThat(canEdit).isFalse();
        }
    }

    // ==================== Page Not Found Tests ====================

    @Nested
    @DisplayName("Page Not Found Tests")
    class PageNotFoundTests {

        @Test
        @DisplayName("Should return false when page does not exist")
        void shouldReturnFalseWhenPageNotFound() {
            setupAuthentication(editorUser);
            when(wikiPageRepository.existsById(999L)).thenReturn(false);

            boolean canView = securityValidator.canView(999L);

            assertThat(canView).isFalse();
        }
    }

    // ==================== Utility Methods ====================

    @Nested
    @DisplayName("Utility Method Tests")
    class UtilityMethodTests {

        @Test
        @DisplayName("isAuthenticated should return true for authenticated user")
        void isAuthenticatedShouldReturnTrueForAuthenticatedUser() {
            when(securityContext.getAuthentication()).thenReturn(authentication);
            when(authentication.isAuthenticated()).thenReturn(true);
            when(authentication.getName()).thenReturn("user");

            boolean isAuthenticated = securityValidator.isAuthenticated();

            assertThat(isAuthenticated).isTrue();
        }

        @Test
        @DisplayName("isAuthenticated should return false for anonymous user")
        void isAuthenticatedShouldReturnFalseForAnonymousUser() {
            when(securityContext.getAuthentication()).thenReturn(authentication);
            when(authentication.isAuthenticated()).thenReturn(true);
            when(authentication.getName()).thenReturn("anonymousUser");

            boolean isAuthenticated = securityValidator.isAuthenticated();

            assertThat(isAuthenticated).isFalse();
        }

        @Test
        @DisplayName("isAdmin should return true for admin user")
        void isAdminShouldReturnTrueForAdminUser() {
            setupAuthentication(adminUser);

            boolean isAdmin = securityValidator.isAdmin();

            assertThat(isAdmin).isTrue();
        }

        @Test
        @DisplayName("isAdmin should return false for non-admin user")
        void isAdminShouldReturnFalseForNonAdminUser() {
            setupAuthentication(editorUser);

            boolean isAdmin = securityValidator.isAdmin();

            assertThat(isAdmin).isFalse();
        }

        @Test
        @DisplayName("isSensitivePage should return true for page with permissions")
        void isSensitivePageShouldReturnTrueForRestrictedPage() {
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(3L);

            boolean isSensitive = securityValidator.isSensitivePage(100L);

            assertThat(isSensitive).isTrue();
        }

        @Test
        @DisplayName("isSensitivePage should return false for public page")
        void isSensitivePageShouldReturnFalseForPublicPage() {
            when(permissionRepository.countByWikiPageId(100L)).thenReturn(0L);

            boolean isSensitive = securityValidator.isSensitivePage(100L);

            assertThat(isSensitive).isFalse();
        }
    }

    // ==================== Helper Methods ====================

    private void setupAuthentication(User user) {
        when(securityContext.getAuthentication()).thenReturn(authentication);
        when(authentication.isAuthenticated()).thenReturn(true);
        when(authentication.getName()).thenReturn(user.getUsername());
        when(userRepository.findByUsernameWithRoles(user.getUsername())).thenReturn(Optional.of(user));
    }
}