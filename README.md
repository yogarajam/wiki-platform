# Wiki Application

A full-stack wiki platform built with **Spring Boot 3** and **React 18**, featuring hierarchical page management with folder support, rich-text editing with Editor.js, file attachments via MinIO object storage, full-text search (pages, content, and attachment filenames) powered by Apache Tika, and role-based access control with page-level permissions.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Default Users](#default-users)
- [API Reference](#api-reference)
- [Security](#security)
- [Data Storage & Persistence](#data-storage--persistence)
- [Backup & Restore](#backup--restore)
- [Documentation](#documentation)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

### Core Wiki
- **Hierarchical page tree** &mdash; Organize pages in a parent-child tree with unlimited nesting depth
- **Folder support** &mdash; Create folders to organize pages; folders display a folder icon, sort before pages at each level, and show a dedicated folder view (no editor) with quick-create buttons
- **Move pages & folders** &mdash; Relocate any page or folder via a visual tree picker modal; circular reference detection prevents invalid moves
- **Rich-text editor** &mdash; Editor.js-based block editor with headers, lists, quotes, code blocks, inline formatting, and images
- **Wiki-style backlinks** &mdash; `[[PageName]]` and `[[PageName|Display Text]]` internal link syntax with automatic backlink tracking
- **URL-friendly slugs** &mdash; Auto-generated, unique, URL-safe slugs for every page
- **Page versioning** &mdash; Automatic version increments on every edit

### File Management
- **MinIO object storage** &mdash; S3-compatible file storage for attachments
- **Drag-and-drop image upload** &mdash; Drop images directly into the editor
- **Multipart upload** &mdash; Large file support with automatic chunked uploads (threshold: 10 MB)
- **Retry with exponential backoff** &mdash; Resilient uploads with configurable retry count

### Search
- **Full-text page search** &mdash; Search across page titles, content, and attachment filenames
- **Document content search** &mdash; Apache Tika extracts text from PDF, Word, Excel, PowerPoint, OpenDocument, RTF, HTML, and plain text files
- **Attachment filename search** &mdash; Searching for a filename returns the page it's attached to
- **Async indexing** &mdash; Attachment text extraction runs asynchronously after upload
- **Admin reindex** &mdash; Full or per-page reindex via API

### Security & Access Control
- **Role-based access control (RBAC)** &mdash; Three predefined roles: Admin, Editor, Viewer
- **Page-level permissions** &mdash; Fine-grained VIEW / EDIT / DELETE / MANAGE_PERMISSIONS / FULL_ACCESS per user or role
- **Sensitive page protection** &mdash; Mark pages as sensitive to restrict access beyond default role permissions
- **Spring Security** &mdash; HTTP Basic + Form Login, BCrypt password hashing, CORS, session management

### Admin UI
- **Permissions modal** &mdash; Admin users can manage page permissions directly from the page header (grant/revoke user or role permissions, toggle sensitive status)
- **Admin panel** &mdash; Topbar button opens a modal with search index statistics, reindex actions (full or per-page), and sensitive pages list
- **Role-aware UI** &mdash; Admin-only buttons (Permissions, Admin) are hidden from non-admin users

### Export
- **Download as PDF** &mdash; Client-side PDF generation from any wiki page using html2pdf.js; A4 format, portrait orientation, 10mm margins, page-title-based filename

### Data Management
- **Persistent bind mounts** &mdash; Database and file storage use host-directory bind mounts (`./data/`), safe from `docker-compose down -v`
- **Backup & restore scripts** &mdash; One-command backup (`./backup.sh`) and restore (`./restore.sh`) with timestamped archives

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Java 17, Spring Boot 3.2.2, Spring Data JPA, Spring Security, Lombok |
| **Frontend** | React 18, React Router 6, Editor.js, Axios, html2pdf.js |
| **Database** | PostgreSQL 15 |
| **Object Storage** | MinIO (S3-compatible) via AWS SDK v2 |
| **Document Parsing** | Apache Tika 2.9.1 |
| **Testing** | JUnit 5, Testcontainers, Spring Security Test |
| **Containerization** | Docker Compose |

---

## Architecture Overview

```
+--------------------------------------------------------------+
|                     React Frontend (:3000)                     |
|   +----------------+  +--------------+  +------------------+  |
|   |PageTreeSidebar |  |  WikiEditor  |  |   API Service    |  |
|   |(folders+pages) |  | (Editor.js)  |  |   (Axios)        |  |
|   +----------------+  +--------------+  +------------------+  |
+-----------------------------+--------------------------------+
                              | HTTP (proxied to :8080)
+-----------------------------v--------------------------------+
|                 Spring Boot Backend (:8080)                    |
|   +--------------+  +--------------+  +------------------+   |
|   |WikiPageCtrl  |  |AttachmentCtrl|  |  SearchCtrl      |   |
|   |PermissionCtrl|  |  AdminCtrl   |  |                  |   |
|   +------+-------+  +------+-------+  +------+----------+   |
|          |                 |                 |               |
|   +------v-------+  +-----v--------+  +-----v-----------+   |
|   |WikiPageService|  |MinioStorage  |  |SearchService     |   |
|   |PageSecurity  |  |Service       |  |TextExtraction   |   |
|   +------+-------+  +------+-------+  +------+----------+   |
|          |                 |                 |               |
|   +------v-------+  +-----v--------+  +-----v-----------+   |
|   | PostgreSQL   |  |    MinIO      |  |  Apache Tika    |   |
|   |  (JPA/Hib.)  |  |  (S3 SDK v2) |  |                 |   |
|   +--------------+  +--------------+  +------------------+   |
+--------------------------------------------------------------+

Data on disk:
  ./data/postgres/    PostgreSQL data (bind mount)
  ./data/minio/       MinIO object storage (bind mount)
```

---

## Prerequisites

| Tool | Minimum Version |
|---|---|
| Java JDK | 17+ |
| Maven | 3.8+ |
| Node.js | 18+ |
| npm | 9+ |
| Docker & Docker Compose | Latest |

---

## Quick Start

### 1. Start Infrastructure (PostgreSQL + MinIO)

```bash
docker-compose up -d
```

This starts:
- **PostgreSQL** on port `5432` (database: `wikidb`, user: `wiki`, password: `wiki123`)
- **MinIO S3 API** on port `9000`
- **MinIO Console** on port `9001` (user: `minioadmin`, password: `minioadmin123`)
- **MinIO Init** container that creates the `wiki-attachments` bucket

Data is stored in `./data/postgres/` and `./data/minio/` (bind mounts on your machine).

### 2. Start the Backend

```bash
./mvnw spring-boot:run
```

The Spring Boot application starts on **http://localhost:8080**. On first run it automatically creates:
- Default roles: `ROLE_ADMIN`, `ROLE_EDITOR`, `ROLE_VIEWER`
- Default users (see [Default Users](#default-users))
- Database schema via Hibernate `ddl-auto=update`

### 3. Start the Frontend

```bash
cd frontend
npm install
npm start
```

The React dev server starts on **http://localhost:3000** and proxies API requests to `:8080`.

### 4. Open the Application

Navigate to **http://localhost:3000** in your browser.

---

## Project Structure

```
wiki-app/
├── docker-compose.yml              # PostgreSQL + MinIO (bind mounts)
├── pom.xml                          # Maven build (Spring Boot 3.2.2)
├── backup.sh                        # Database + MinIO backup script
├── restore.sh                       # Restore from backup archive
├── .gitignore                       # Excludes data/, target/, node_modules/
├── data/                            # Persistent data (bind mounts, git-ignored)
│   ├── postgres/                    # PostgreSQL data files
│   └── minio/                       # MinIO object storage files
│       └── wiki-attachments/        # S3 bucket with uploaded files
├── backups/                         # Timestamped backup archives (created by backup.sh)
├── src/
│   ├── main/
│   │   ├── java/com/wiki/
│   │   │   ├── WikiApplication.java         # Spring Boot main class
│   │   │   ├── config/
│   │   │   │   ├── AsyncConfig.java          # Async task executor
│   │   │   │   ├── DataInitializer.java       # Default roles & users
│   │   │   │   ├── S3Config.java              # AWS SDK S3 client for MinIO
│   │   │   │   ├── SecurityConfig.java        # Spring Security rules
│   │   │   │   └── WebConfig.java             # CORS & web config
│   │   │   ├── controller/
│   │   │   │   ├── AdminController.java       # User/role listing, current user info
│   │   │   │   ├── AttachmentController.java  # File upload/download/delete
│   │   │   │   ├── GlobalExceptionHandler.java# Centralized error handling
│   │   │   │   ├── PermissionController.java  # Page permission management
│   │   │   │   ├── SearchController.java      # Search & reindex endpoints
│   │   │   │   └── WikiPageController.java    # Page CRUD, tree, move, folders
│   │   │   ├── dto/
│   │   │   │   ├── AttachmentDTO.java
│   │   │   │   ├── PermissionDTO.java
│   │   │   │   ├── SearchResultDTO.java
│   │   │   │   ├── UploadResponseDTO.java
│   │   │   │   ├── WikiPageDTO.java           # Includes folder boolean
│   │   │   │   └── WikiPageTreeDTO.java       # Includes folder boolean
│   │   │   ├── exception/
│   │   │   │   └── StorageException.java      # Custom storage error codes
│   │   │   ├── model/
│   │   │   │   ├── Attachment.java
│   │   │   │   ├── PagePermission.java
│   │   │   │   ├── Role.java
│   │   │   │   ├── SearchableContent.java
│   │   │   │   ├── User.java
│   │   │   │   └── WikiPage.java              # Includes folder field
│   │   │   ├── repository/
│   │   │   │   ├── AttachmentRepository.java
│   │   │   │   ├── PagePermissionRepository.java
│   │   │   │   ├── RoleRepository.java
│   │   │   │   ├── SearchableContentRepository.java
│   │   │   │   ├── UserRepository.java
│   │   │   │   └── WikiPageRepository.java    # Search includes attachments
│   │   │   ├── security/
│   │   │   │   ├── SecurityValidator.java     # Page-level access checks
│   │   │   │   └── WikiUserDetailsService.java
│   │   │   └── service/
│   │   │       ├── MinioStorageService.java   # S3 upload/download/delete
│   │   │       ├── PageSecurityService.java   # Permission CRUD
│   │   │       ├── SearchService.java         # Unified search + indexing
│   │   │       ├── TextExtractionService.java # Apache Tika wrapper
│   │   │       └── WikiPageService.java       # Page CRUD, backlinks, folders
│   │   └── resources/
│   │       └── application.properties
│   └── test/java/com/wiki/
│       ├── controller/
│       │   ├── AttachmentControllerTest.java
│       │   ├── GlobalExceptionHandlerTest.java
│       │   ├── PermissionControllerIntegrationTest.java
│       │   ├── SearchControllerTest.java
│       │   ├── WikiPageControllerIntegrationTest.java
│       │   └── WikiPageControllerTest.java
│       ├── exception/StorageExceptionTest.java
│       ├── integration/WikiPageLifecycleIntegrationTest.java
│       ├── model/
│       │   ├── PagePermissionTest.java
│       │   ├── UserTest.java
│       │   └── WikiPageTest.java
│       ├── repository/
│       │   ├── PagePermissionRepositoryIntegrationTest.java
│       │   └── WikiPageRepositoryIntegrationTest.java
│       ├── security/
│       │   ├── SecurityValidatorTest.java
│       │   └── WikiUserDetailsServiceTest.java
│       └── service/
│           ├── MinioStorageServiceErrorHandlingTest.java
│           ├── MinioStorageServiceTest.java
│           ├── MinioStorageServiceUnitTest.java
│           ├── PageSecurityServiceTest.java
│           ├── SearchServiceTest.java
│           ├── TextExtractionServiceTest.java
│           └── WikiPageServiceTest.java
├── frontend/
│   ├── package.json
│   ├── public/index.html
│   └── src/
│       ├── App.jsx                            # Router, auth, admin state
│       ├── App.css
│       ├── index.js
│       ├── services/api.js                    # Axios API client (auth, CRUD, permissions, admin)
│       ├── components/
│       │   ├── AdminPanel/
│       │   │   ├── AdminPanel.jsx             # Search stats, reindex, sensitive pages
│       │   │   └── AdminPanel.css
│       │   ├── PermissionsModal/
│       │   │   ├── PermissionsModal.jsx       # Page permission management UI
│       │   │   └── PermissionsModal.css
│       │   ├── WikiEditor/
│       │   │   ├── WikiEditor.jsx
│       │   │   ├── WikiEditor.css
│       │   │   └── index.js
│       │   └── PageTreeSidebar/
│       │       ├── PageTreeSidebar.jsx        # Folder icons, create folder btn
│       │       ├── PageTreeSidebar.css
│       │       └── index.js
│       └── pages/
│           └── WikiPage/
│               ├── WikiPage.jsx               # Folder view, move modal, permissions
│               ├── WikiPage.css
│               └── index.js
└── docs/
    ├── user-manual.html
    ├── development-guide.html
    ├── deployment-guide.html
    ├── architecture.html
    └── api-reference.html
```

---

## Configuration

All application settings are in `src/main/resources/application.properties`:

| Property | Default | Description |
|---|---|---|
| `spring.datasource.url` | `jdbc:postgresql://localhost:5432/wikidb` | PostgreSQL connection URL |
| `spring.datasource.username` | `wiki` | Database username |
| `spring.datasource.password` | `wiki123` | Database password |
| `spring.jpa.hibernate.ddl-auto` | `update` | Schema management strategy |
| `minio.endpoint` | `http://localhost:9000` | MinIO S3 API endpoint |
| `minio.access-key` | `minioadmin` | MinIO access key |
| `minio.secret-key` | `minioadmin123` | MinIO secret key |
| `minio.bucket` | `wiki-attachments` | Default S3 bucket name |
| `minio.region` | `us-east-1` | S3 region |
| `minio.max-retries` | `3` | Upload retry count |
| `spring.servlet.multipart.max-file-size` | `100MB` | Max upload file size |
| `spring.servlet.multipart.max-request-size` | `100MB` | Max request size |

---

## Default Users

The application seeds the following users on first startup:

| Username | Password | Role | Permissions |
|---|---|---|---|
| `admin` | `admin123` | ROLE_ADMIN | Full access: create, edit, delete, manage permissions |
| `editor` | `editor123` | ROLE_EDITOR | Create and edit pages; cannot delete |
| `viewer` | `viewer123` | ROLE_VIEWER | View-only access to non-sensitive pages |

> **Important:** Change these credentials before deploying to production.

---

## API Reference

### Wiki Pages (`/api/pages`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/pages/tree` | Public | Get hierarchical page tree (includes `folder` field, folders sorted first) |
| `GET` | `/api/pages/{id}` | Authenticated | Get page by ID (includes `folder` field) |
| `GET` | `/api/pages/slug/{slug}` | Public | Get page by slug |
| `GET` | `/api/pages/{id}/backlinks` | Authenticated | Get pages linking to this page |
| `GET` | `/api/pages/search?q=` | Public | Search pages by title, content, and attachment filenames |
| `POST` | `/api/pages` | Editor/Admin | Create a new page or folder (`folder: true`) |
| `PUT` | `/api/pages/{id}` | Editor/Admin | Update a page |
| `PUT` | `/api/pages/{id}/move` | Editor/Admin | Move page/folder to new parent (`{ "parentId": <id|null> }`) |
| `DELETE` | `/api/pages/{id}` | Admin only | Delete a page or folder |

**Create folder example:**
```json
POST /api/pages
{
  "title": "My Folder",
  "folder": true,
  "parentId": null
}
```

**Move page example:**
```json
PUT /api/pages/5/move
{
  "parentId": 3
}
```

### Attachments (`/api/attachments`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/attachments/upload` | Editor/Admin | Upload file (multipart/form-data) |
| `GET` | `/api/attachments/page/{pageId}` | Authenticated | List attachments for a page |
| `GET` | `/api/attachments/{id}/download-url` | Authenticated | Get download URL |
| `DELETE` | `/api/attachments/{id}` | Editor/Admin | Delete an attachment |

### Search (`/api/search`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/search?q=` | Authenticated | Unified search (pages + attachment content) |
| `GET` | `/api/search/attachments?q=` | Authenticated | Search attachments only |
| `GET` | `/api/search/page/{pageId}/attachments?q=` | Authenticated | Search within page's attachments |
| `GET` | `/api/search/stats` | Admin | Get search index statistics |
| `POST` | `/api/search/reindex` | Admin | Trigger full reindex |
| `POST` | `/api/search/reindex/page/{pageId}` | Admin | Reindex a specific page |

> **Note:** The sidebar search (`GET /api/pages/search?q=`) also matches attachment filenames. For example, searching "passport" will find a page that has "Yoga Passport.pdf" attached.

### Admin (`/api/admin`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/me` | Authenticated | Get current user's username and roles |
| `GET` | `/api/admin/users` | Admin | List all users (id, username, displayName) |
| `GET` | `/api/admin/roles` | Admin | List all roles (id, name, description) |

### Permissions (`/api/permissions`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/permissions/page/{pageId}` | Admin | Get page permissions |
| `POST` | `/api/permissions/page/{pageId}/user/{userId}` | Admin | Grant user permission |
| `POST` | `/api/permissions/page/{pageId}/role/{roleId}` | Admin | Grant role permission |
| `DELETE` | `/api/permissions/page/{pageId}/user/{userId}?permissionType=` | Admin | Revoke user permission |
| `DELETE` | `/api/permissions/page/{pageId}/role/{roleId}?permissionType=` | Admin | Revoke role permission |
| `DELETE` | `/api/permissions/page/{pageId}` | Admin | Revoke all permissions |
| `POST` | `/api/permissions/page/{pageId}/sensitive` | Admin | Mark page as sensitive |
| `POST` | `/api/permissions/page/{pageId}/public` | Admin | Mark page as public |
| `GET` | `/api/permissions/page/{pageId}/sensitive` | Admin | Check if page is sensitive |
| `GET` | `/api/permissions/sensitive-pages` | Admin | List all sensitive page IDs |

---

## Security

### Authentication

The application supports two authentication methods:
- **HTTP Basic** &mdash; for API clients (send `Authorization: Basic <base64>` header)
- **Form Login** &mdash; for browser-based access (POST to `/api/auth/login`)

### Authorization Flow

1. **Admins** always have full access to every page and endpoint
2. **Public endpoints** (page tree, slug lookup, search) require no authentication
3. **Read endpoints** require authentication; Editors and Viewers can read non-sensitive pages
4. **Write endpoints** (create, edit, move) require Editor or Admin role
5. **Delete endpoints** require Admin role only
6. **Sensitive pages** require explicit page-level permission grants

### Permission Types

| Type | Description |
|---|---|
| `VIEW` | Can view the page |
| `EDIT` | Can edit the page |
| `DELETE` | Can delete the page |
| `MANAGE_PERMISSIONS` | Can manage page permissions |
| `FULL_ACCESS` | All of the above |

---

## Data Storage & Persistence

All application data is stored in two locations on your host machine:

| Data | Location | Contents |
|---|---|---|
| **PostgreSQL** | `./data/postgres/` | Wiki pages, users, roles, permissions, attachment metadata, search index |
| **MinIO** | `./data/minio/` | Uploaded files (PDFs, images, documents) in `wiki-attachments` bucket |

### How it works

The `docker-compose.yml` uses **bind mounts** (not Docker volumes), mapping container data directly to the `./data/` directory on your machine:

```yaml
# PostgreSQL
volumes:
  - ./data/postgres:/var/lib/postgresql/data

# MinIO
volumes:
  - ./data/minio:/data
```

This means:
- Data **survives** `docker-compose down` and `docker-compose down -v`
- Data is **visible** on your filesystem for easy backup
- Data persists across container rebuilds and upgrades
- To **reset** all data, delete the `./data/` directory and restart containers

### Port Summary

| Service | Port | Purpose |
|---|---|---|
| React Dev Server | 3000 | Frontend |
| Spring Boot Backend | 8080 | API Server |
| PostgreSQL | 5432 | Database |
| MinIO S3 API | 9000 | Object Storage API |
| MinIO Web Console | 9001 | MinIO Admin UI |

---

## Backup & Restore

### Create a Backup

```bash
./backup.sh
```

This creates a timestamped archive in `./backups/` containing:
- Full PostgreSQL database dump (`wikidb.sql`)
- All MinIO files (attachments, images)

Example output:
```
=== Wiki App Backup: wiki-backup-20260210_153000 ===
Backing up PostgreSQL...
  Database backup: OK (45231 bytes)
Backing up MinIO files...
  MinIO backup: OK (16 files)
Compressing...

Backup complete: ./backups/wiki-backup-20260210_153000.tar.gz (78M)
```

### Restore from Backup

```bash
./restore.sh ./backups/wiki-backup-20260210_153000.tar.gz
```

This restores the database and MinIO files from the specified archive. You'll be prompted to confirm before overwriting current data.

After restoring, restart services:
```bash
docker-compose restart
```

### Manual Database Backup

If you prefer manual commands:

```bash
# Export database
docker exec wiki-postgres pg_dump -U wiki -d wikidb > backup.sql

# Import database
docker exec -i wiki-postgres psql -U wiki -d wikidb < backup.sql
```

---

## Documentation

Detailed HTML documentation is available in the `docs/` directory:

| Document | Description |
|---|---|
| [User Manual](docs/user-manual.html) | End-user guide: pages, folders, editor, search, attachments, move |
| [Development Guide](docs/development-guide.html) | Developer setup, architecture, coding conventions |
| [Deployment Guide](docs/deployment-guide.html) | Build, deployment, backup, and production configuration |
| [Architecture](docs/architecture.html) | System design, data model, and component overview |
| [API Reference](docs/api-reference.html) | Complete REST API documentation with examples |

---

## Testing

### Run Backend Tests

```bash
./mvnw test
```

307 tests across 22 test classes:

**Unit tests:**
- `WikiPageServiceTest` &mdash; Page CRUD, hierarchy, backlink parsing, slug generation
- `SearchServiceTest` &mdash; Unified search, attachment search, indexing, stats
- `TextExtractionServiceTest` &mdash; Tika document extraction for 14+ MIME types
- `PageSecurityServiceTest` &mdash; Permission CRUD operations
- `MinioStorageServiceUnitTest` &mdash; Storage operations with mocked S3 client
- `SecurityValidatorTest` &mdash; Page-level permission checks for all roles
- `WikiUserDetailsServiceTest` &mdash; User details loading
- `WikiPageControllerTest` &mdash; Page REST endpoint unit tests
- `AttachmentControllerTest` &mdash; Attachment endpoint unit tests
- `SearchControllerTest` &mdash; Search endpoint unit tests
- `GlobalExceptionHandlerTest` &mdash; Error handling
- `WikiPageTest`, `UserTest`, `PagePermissionTest` &mdash; Model/entity tests
- `StorageExceptionTest` &mdash; Custom exception tests

**Integration tests:**
- `WikiPageControllerIntegrationTest` &mdash; Full page lifecycle with security
- `PermissionControllerIntegrationTest` &mdash; Permission endpoints with security
- `WikiPageLifecycleIntegrationTest` &mdash; End-to-end page operations
- `WikiPageRepositoryIntegrationTest` &mdash; Repository queries with H2
- `PagePermissionRepositoryIntegrationTest` &mdash; Permission repository queries

**Docker-dependent tests (Testcontainers):**
- `MinioStorageServiceTest` &mdash; File upload/download with real MinIO container
- `MinioStorageServiceErrorHandlingTest` &mdash; Retry logic and error codes

> **Note:** Testcontainers tests require Docker. To skip them: `./mvnw test -Dtest='!MinioStorageServiceTest,!MinioStorageServiceErrorHandlingTest'`

### Run Frontend Tests

```bash
cd frontend
npm test
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Cannot connect to PostgreSQL | Ensure `docker-compose up -d` is running and port `5432` is free |
| MinIO upload fails | Check MinIO is healthy: `curl http://localhost:9000/minio/health/live` |
| CORS errors in browser | Frontend must run on `http://localhost:3000` (configured origin) |
| `403 Forbidden` on delete | Only admin role can delete. Log in as `admin` / `admin123` |
| `403 Forbidden` on create/edit | Requires Editor or Admin role. Viewer cannot write. |
| Large file upload timeout | Increase `spring.servlet.multipart.max-file-size` and client timeout |
| Search not finding attachments | Sidebar search matches filenames. For content search, trigger reindex: `POST /api/search/reindex` |
| New column errors after update | If Hibernate can't add a NOT NULL column to existing data, add manually: `docker exec wiki-postgres psql -U wiki -d wikidb -c "ALTER TABLE wiki_pages ADD COLUMN <col> <type> NOT NULL DEFAULT <val>;"` |
| Data directory empty | Run `docker-compose up -d` to create `./data/` contents. First run initializes the database. |

---

## License

This project is proprietary. All rights reserved.
