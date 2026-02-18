import React, { useEffect, useRef, useState, useCallback } from 'react';
import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';
import List from '@editorjs/list';
import Quote from '@editorjs/quote';
import Code from '@editorjs/code';
// LinkTool removed — requires /api/link-preview backend endpoint
import Marker from '@editorjs/marker';
import InlineCode from '@editorjs/inline-code';
import ImageTool from '@editorjs/image';
import Table from '@editorjs/table';
import { uploadApi } from '../../services/api';
import './WikiEditor.css';

/**
 * WikiEditor Component
 * Rich text editor with Editor.js, supporting drag-and-drop image uploads
 */
const WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

const WikiEditor = ({
    pageId,
    initialContent,
    onChange,
    onSave,
    onWikiLinkClick,
    readOnly = false,
}) => {
    const editorRef = useRef(null);
    const editorInstance = useRef(null);
    const [isReady, setIsReady] = useState(false);

    // Registered Editor.js block types
    const SUPPORTED_BLOCK_TYPES = new Set([
        'paragraph', 'header', 'list', 'quote', 'code', 'table', 'marker', 'inlineCode', 'image',
    ]);

    // Parse initial content if it's a string
    const parseContent = useCallback((content) => {
        if (!content) {
            return { blocks: [] };
        }
        let parsed;
        if (typeof content === 'string') {
            try {
                parsed = JSON.parse(content);
            } catch {
                // If it's plain text, wrap in paragraph block
                return {
                    blocks: [
                        {
                            type: 'paragraph',
                            data: { text: content },
                        },
                    ],
                };
            }
        } else {
            parsed = content;
        }

        // Filter out unsupported block types (e.g. linkTool) to prevent Editor.js errors
        if (parsed && parsed.blocks) {
            parsed.blocks = parsed.blocks.map((block) => {
                if (SUPPORTED_BLOCK_TYPES.has(block.type)) {
                    return block;
                }
                // Convert linkTool blocks to paragraph with clickable link
                if (block.type === 'linkTool' && block.data) {
                    const url = block.data.link || '';
                    const title = block.data.meta?.title || url;
                    return {
                        type: 'paragraph',
                        data: { text: `<a href="${url}" target="_blank">${title}</a>` },
                    };
                }
                // Skip other unknown block types
                return null;
            }).filter(Boolean);
        }
        return parsed;
    }, []);

    // Custom image uploader for Editor.js
    const imageUploader = useCallback(
        (file) => {
            return uploadApi.uploadImage(file, pageId);
        },
        [pageId]
    );

    // Initialize Editor.js (once per mount)
    useEffect(() => {
        if (!editorRef.current || editorInstance.current) return;

        const editor = new EditorJS({
            holder: editorRef.current,
            readOnly,
            placeholder: 'Start writing your wiki page...',
            data: parseContent(initialContent),
            tools: {
                header: {
                    class: Header,
                    config: {
                        levels: [1, 2, 3, 4],
                        defaultLevel: 2,
                    },
                },
                list: {
                    class: List,
                    inlineToolbar: true,
                },
                quote: {
                    class: Quote,
                    inlineToolbar: true,
                    config: {
                        quotePlaceholder: 'Enter a quote',
                        captionPlaceholder: 'Quote author',
                    },
                },
                code: Code,
                table: {
                    class: Table,
                    inlineToolbar: true,
                    config: {
                        rows: 2,
                        cols: 3,
                    },
                },
                marker: Marker,
                inlineCode: InlineCode,
                image: {
                    class: ImageTool,
                    config: {
                        uploader: {
                            uploadByFile: imageUploader,
                            uploadByUrl: async (url) => {
                                return {
                                    success: 1,
                                    file: { url },
                                };
                            },
                        },
                        captionPlaceholder: 'Image caption',
                    },
                },
            },
            onChange: async () => {
                if (onChange && editorInstance.current) {
                    try {
                        const data = await editorInstance.current.save();
                        onChange(data);
                    } catch (error) {
                        console.error('Error saving editor content:', error);
                    }
                }
            },
            onReady: () => {
                setIsReady(true);
            },
        });

        editorInstance.current = editor;

        return () => {
            if (editorInstance.current && editorInstance.current.destroy) {
                editorInstance.current.destroy();
                editorInstance.current = null;
            }
        };
    }, [pageId]); // eslint-disable-line

    // Toggle readOnly mode without destroying the editor
    useEffect(() => {
        if (!editorInstance.current || !isReady) return;

        const toggle = async () => {
            try {
                const currentMode = await editorInstance.current.readOnly.toggle();
                // If the toggled mode doesn't match desired, toggle again
                if (currentMode !== readOnly) {
                    await editorInstance.current.readOnly.toggle();
                }
            } catch (error) {
                console.error('Error toggling readOnly:', error);
            }
        };

        toggle();
    }, [readOnly, isReady]);

    // Process wiki links in rendered content (read-only mode)
    // Handles both [[PageName]] syntax AND <a href="#"> page links
    useEffect(() => {
        if (!isReady || !readOnly || !editorRef.current) return;

        const processWikiLinks = () => {
            const container = editorRef.current;

            // 1. Process [[PageName]] wiki link syntax in text nodes
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            const textNodes = [];
            let node;
            while ((node = walker.nextNode())) {
                if (WIKI_LINK_REGEX.test(node.textContent)) {
                    textNodes.push(node);
                }
                WIKI_LINK_REGEX.lastIndex = 0;
            }

            textNodes.forEach((textNode) => {
                const text = textNode.textContent;
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                let match;

                WIKI_LINK_REGEX.lastIndex = 0;
                while ((match = WIKI_LINK_REGEX.exec(text)) !== null) {
                    if (match.index > lastIndex) {
                        fragment.appendChild(
                            document.createTextNode(text.slice(lastIndex, match.index))
                        );
                    }

                    const pageName = match[1].trim();
                    const displayText = match[2] ? match[2].trim() : pageName;

                    const link = document.createElement('a');
                    link.className = 'wiki-link';
                    link.href = '#';
                    link.textContent = displayText;
                    link.dataset.pageName = pageName;
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (onWikiLinkClick) {
                            onWikiLinkClick(pageName);
                        }
                    });

                    fragment.appendChild(link);
                    lastIndex = match.index + match[0].length;
                }

                if (lastIndex < text.length) {
                    fragment.appendChild(
                        document.createTextNode(text.slice(lastIndex))
                    );
                }

                textNode.parentNode.replaceChild(fragment, textNode);
            });

            // 2. Process <a href="#"> links as internal page links
            // These are created by Editor.js inline link tool with "#" as URL
            const anchorLinks = container.querySelectorAll('a[href="#"]');
            anchorLinks.forEach((anchor) => {
                const pageName = anchor.textContent.trim();
                if (!pageName || anchor.classList.contains('wiki-link')) return;

                anchor.className = 'wiki-link';
                anchor.dataset.pageName = pageName;
                anchor.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onWikiLinkClick) {
                        onWikiLinkClick(pageName);
                    }
                });
            });
        };

        // Small delay to ensure Editor.js has fully rendered
        const timer = setTimeout(processWikiLinks, 100);
        return () => clearTimeout(timer);
    }, [isReady, readOnly, onWikiLinkClick]);

    // Save editor content
    const handleSave = useCallback(async () => {
        if (!editorInstance.current || !onSave) return;

        try {
            const data = await editorInstance.current.save();
            await onSave(data);
        } catch (error) {
            console.error('Error saving:', error);
            throw error;
        }
    }, [onSave]);

    // Expose save method via ref
    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.save = handleSave;
        }
    }, [handleSave]);

    return (
        <div className="wiki-editor-container">
            <div
                className={`wiki-editor ${!isReady ? 'loading' : ''}`}
            >
                {!isReady && (
                    <div className="editor-loading">
                        <span>Loading editor...</span>
                    </div>
                )}
                <div ref={editorRef} className="editor-content" />
            </div>
        </div>
    );
};

export default WikiEditor;