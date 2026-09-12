// src/commands/upload-storage-types.ts
// Shared types for upload-storage command modules (avoids circular imports)

export interface UploadStorageOptions {
  filePath: string;
  virtualPath: string;
  storageChannelId?: string;
  force?: boolean;
}
