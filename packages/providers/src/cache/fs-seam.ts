/**
 * Filesystem seam (issue #10 section 18). FileEntryStore performs every disk
 * operation through this narrow interface so atomicity, corruption, and
 * contention fixtures run without racing a real filesystem. The production
 * implementation delegates to Deno; fixtures inject a memory or wrapping
 * implementation.
 *
 * The write contract mirrors issue #5 D3: same-directory temp creation, full
 * write, flush (sync), close, then rename. `openForWrite` returns a handle
 * whose close completes the flush-close step the store controls.
 */

export type FsError = "not_found" | "permission_denied" | "other";

export type FsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: FsError; readonly message?: string };

export interface FsStat {
  readonly kind: "file" | "dir";
  readonly size: number;
  readonly mtimeMs: number;
}

export type FsStatResult =
  | { readonly ok: true; readonly stat: FsStat }
  | { readonly ok: false; readonly error: FsError };

export interface FsWriteHandle {
  write(text: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export type FsOpenResult =
  | { readonly ok: true; readonly handle: FsWriteHandle }
  | { readonly ok: false; readonly error: FsError; readonly message?: string };

export type FsReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: FsError };

export type FsListResult =
  | { readonly ok: true; readonly names: string[] }
  | { readonly ok: false; readonly error: FsError };

export interface FileSystemSeam {
  mkdir(
    path: string,
    options?: { readonly recursive?: boolean; readonly mode?: number },
  ): Promise<FsResult>;
  stat(path: string): Promise<FsStatResult>;
  openForWrite(path: string): Promise<FsOpenResult>;
  readTextFile(path: string): Promise<FsReadResult>;
  rename(from: string, to: string): Promise<FsResult>;
  remove(path: string): Promise<FsResult>;
  listDirectory(path: string): Promise<FsListResult>;
}

function describeError(
  error: unknown,
): { readonly error: FsError; readonly message?: string } {
  if (error instanceof Deno.errors.NotFound) return { error: "not_found" };
  if (error instanceof Deno.errors.PermissionDenied) {
    return { error: "permission_denied" };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { error: "other", message };
}

/** Production filesystem seam over the Deno runtime. */
export class DenoFileSystemSeam implements FileSystemSeam {
  async mkdir(
    path: string,
    options: { readonly recursive?: boolean; readonly mode?: number } = {},
  ): Promise<FsResult> {
    try {
      await Deno.mkdir(path, {
        recursive: options.recursive,
        mode: options.mode,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, ...describeError(error) };
    }
  }

  async stat(path: string): Promise<FsStatResult> {
    try {
      const info = await Deno.stat(path);
      return {
        ok: true,
        stat: {
          kind: info.isDirectory ? "dir" : "file",
          size: info.size,
          mtimeMs: info.mtime?.getTime() ?? 0,
        },
      };
    } catch (error) {
      return { ok: false, error: describeError(error).error };
    }
  }

  async openForWrite(path: string): Promise<FsOpenResult> {
    try {
      const file = await Deno.open(path, {
        write: true,
        create: true,
        truncate: true,
      });
      return {
        ok: true,
        handle: {
          async write(text: string): Promise<void> {
            await file.write(new TextEncoder().encode(text));
          },
          async sync(): Promise<void> {
            await file.sync();
          },
          close(): Promise<void> {
            file.close();
            return Promise.resolve();
          },
        },
      };
    } catch (error) {
      return { ok: false, ...describeError(error) };
    }
  }

  async readTextFile(path: string): Promise<FsReadResult> {
    try {
      return { ok: true, text: await Deno.readTextFile(path) };
    } catch (error) {
      return { ok: false, error: describeError(error).error };
    }
  }

  async rename(from: string, to: string): Promise<FsResult> {
    try {
      await Deno.rename(from, to);
      return { ok: true };
    } catch (error) {
      return { ok: false, ...describeError(error) };
    }
  }

  async remove(path: string): Promise<FsResult> {
    try {
      await Deno.remove(path);
      return { ok: true };
    } catch (error) {
      return { ok: false, ...describeError(error) };
    }
  }

  async listDirectory(path: string): Promise<FsListResult> {
    try {
      const names: string[] = [];
      for await (const entry of Deno.readDir(path)) {
        names.push(entry.name);
      }
      return { ok: true, names };
    } catch (error) {
      return { ok: false, error: describeError(error).error };
    }
  }
}
