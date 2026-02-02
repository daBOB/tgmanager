# Telegram File Storage & Channel API Research

**Date:** 2026-02-02 | **Topic:** Telegram file storage capabilities for channel-based file management

---

## 1. File Size Limits

**Regular Accounts:** 2GB per file limit
**Premium Accounts:** 4GB per file limit

Premium also enables faster downloads (removes throttling). Source: [Telegram Premium Features & Price](https://www.androidpolice.com/telegram-premium-guide/)

---

## 2. File Storage in Channels

### Upload Mechanism
- Use `messages.sendMultiMedia` with `inputSingleMedia` constructors (max 10 per media group)
- Each file gets individual caption metadata support
- Files uploadable to channels, saved messages, or private chats

### Key API Methods
- **Upload:** `upload.saveFilePart` → `InputFile` or `InputFileBig` (valid <24h)
- **Download:** `upload.GetFile` (full or partial with offset/limit parameters)
- **CDN:** `upload.GetCdnFile` for CDN-cached files

Source: [Telegram File API](https://core.telegram.org/api/files) | [MadelineProto Docs](https://docs.madelineproto.xyz/docs/FILES.html)

---

## 3. Metadata Organization

### Caption-Based Storage
- Each message supports captions for metadata (file name, description, date, etc.)
- Album captions work when exactly one photo in group has caption
- Practical for associating metadata with files

### Hashtag-Based Indexing (Best Practice)
1. **Strict tagging convention:** `#Category_Type` (e.g., `#Week1_PDF`, `#Archive_Video`)
2. **Master index:** Pin indexed post listing all hashtag combinations
3. **Searchability:** Telegram's native search finds hashtags efficiently
4. **Organization benefit:** Improves retrieval by ~81% vs unorganized storage

Source: [Telegram Channel Organization Guide](https://www.jeffbullas.com/thread/what-is-the-best-way-to-manage-and-organize-large-files-in-a-telegram-channel/)

---

## 4. File Splitting for Large Files

**Problem:** Files >2GB (4GB premium) hit limits

**Solutions:**

| Method | Tool | Notes |
|--------|------|-------|
| **Compression** | WinRAR, 7-Zip, WinZip | Reduces size; may compromise quality |
| **Splitting** | HJSplit, 7-Zip, ChunkIt bot | Splits into parts (part1, part2...); reassemble on download |
| **Telegram-Upload Library** | [Nekmo/telegram-upload](https://github.com/Nekmo/telegram-upload) | Auto-splits files >2GB; PyPI package available |
| **Links** | Google Drive, Dropbox, WeTransfer | Host elsewhere; share link in Telegram |

**Benefit of splitting:** No quality loss vs compression. Each part uploadable as separate message.

---

## 5. GramJS Implementation

### Upload Flow
```
uploadFile(file, workers: 1-15) → InputFile → sendMessage/sendMedia
```
- **Workers parameter:** Higher workers = faster upload but potential instability
- **Performance:** Default (1 worker) = stable/slow; >15 discouraged

### Download Flow
```
downloadMedia(media, workers, throttle) → Buffer or file
- Can specify thumbnail size instead of full media
- Returns undefined if thumbnail doesn't exist
```

Source: [GramJS Documentation](https://gram.js.org/beta/classes/TelegramClient.html)

---

## 6. Storage Channel Best Practices

1. **Private or restricted channel** for file storage (access control)
2. **Message numbering/pinned index** for navigation
3. **Consistent caption format:** `{filename} | {date} | {description}`
4. **Hashtag structure:** Hierarchical tags for filtering
5. **Backup strategy:** Store critical files with duplicate messages or secondary channels
6. **File naming:** Kebab-case with descriptive names for Telegram search

---

## Key Constraints & Opportunities

| Aspect | Constraint | Workaround |
|--------|-----------|-----------|
| Single file limit | 2GB/4GB | Split large files or use compression |
| Message rate limits | ~1 msg/sec in channels | Batch uploads; use scheduled messages |
| File retention | Dependent on account status | Premium ensures longer retention |
| Search | Hashtag-based only | Implement master index for discovery |
| Media groups | Max 10 per group | Use sequential messages for >10 files |

---

## Summary

Telegram channels provide **viable file storage** via:
- 2-4GB per-file capacity with metadata (captions)
- Native hashtag search + pinned index system
- API support for upload/download with partial access
- File splitting as practical solution for >4GB requirements

GramJS enables **programmatic implementation** with worker-configurable upload/download and multi-part file support.

**Next Steps:** Implement file-splitting logic, caption metadata schema, and hashtag indexing system in tgmanager.

---

**Sources:**
- [Telegram File API](https://core.telegram.org/api/files)
- [GramJS Documentation](https://gram.js.org/beta/classes/TelegramClient.html)
- [Telegram Premium Features](https://www.androidpolice.com/telegram-premium-guide/)
- [MadelineProto File Handling](https://docs.madelineproto.xyz/docs/FILES.html)
- [Telegram Upload Library](https://github.com/Nekmo/telegram-upload)
- [Channel Organization Best Practices](https://www.jeffbullas.com/thread/what-is-the-best-way-to-manage-and-organize-large-files-in-a-telegram-channel/)
