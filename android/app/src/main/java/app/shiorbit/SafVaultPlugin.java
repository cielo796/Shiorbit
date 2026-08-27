package app.shiorbit;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Android の Storage Access Framework を VaultAdapter の最小ファイルAPIへ変換する。
 *
 * Directory.Documents は Android 11 以降、アプリ自身が作ったファイルしか扱えない。
 * ACTION_OPEN_DOCUMENT_TREE でユーザーが明示的に許可したツリーは、既存ファイルも
 * 読み書きでき、takePersistableUriPermission により再起動後も利用できる。
 */
@CapacitorPlugin(name = "SafVault")
public class SafVaultPlugin extends Plugin {

    private static final String PREFS_NAME = "shiorbit-saf";
    private static final String PREF_TREE_URI = "tree-uri";
    private static final String MIME_DIRECTORY = DocumentsContract.Document.MIME_TYPE_DIR;

    private static final String[] PROJECTION = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    };

    /** scanTree で解決済みのパスを保持し、以降の read/stat を直接URIへ接続する。 */
    private final Map<String, DocumentInfo> documentCache = new LinkedHashMap<>();
    private String cachedTreeUri;
    private boolean documentCacheComplete;

    private static final class DocumentInfo {

        final Uri uri;
        final String name;
        final String mimeType;
        final long size;
        final long mtime;

        DocumentInfo(Uri uri, String name, String mimeType, long size, long mtime) {
            this.uri = uri;
            this.name = name;
            this.mimeType = mimeType;
            this.size = size;
            this.mtime = mtime;
        }

        boolean isDirectory() {
            return MIME_DIRECTORY.equals(mimeType);
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    // ---------------------------------------------------------------- selection

    @PluginMethod
    public void pickTree(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String saved = preferences().getString(PREF_TREE_URI, null);
            Uri initial = saved == null
                ? DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents",
                    "primary:Documents/Shiorbit"
                )
                : Uri.parse(saved);
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initial);
        }

        startActivityForResult(call, intent, "treePicked");
    }

    @ActivityCallback
    private void treePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("Folder selection cancelled", "PICK_CANCELLED");
            return;
        }

        Uri uri = data.getData();
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            resolver().takePersistableUriPermission(uri, flags);
            clearDocumentCache();
            preferences().edit().putString(PREF_TREE_URI, uri.toString()).apply();
            call.resolve(selectionResult(uri));
        } catch (Exception error) {
            call.reject("フォルダへの永続アクセスを保存できませんでした", "SAF_PERMISSION", error);
        }
    }

    @PluginMethod
    public void getSavedTree(PluginCall call) {
        String saved = preferences().getString(PREF_TREE_URI, null);
        if (saved == null) {
            call.resolve(notSelected());
            return;
        }

        Uri uri = Uri.parse(saved);
        if (!hasPersistedReadPermission(uri)) {
            preferences().edit().remove(PREF_TREE_URI).apply();
            call.resolve(notSelected());
            return;
        }

        try {
            call.resolve(selectionResult(uri));
        } catch (Exception error) {
            preferences().edit().remove(PREF_TREE_URI).apply();
            call.resolve(notSelected());
        }
    }

    @PluginMethod
    public void forgetTree(PluginCall call) {
        String saved = preferences().getString(PREF_TREE_URI, null);
        if (saved != null) {
            Uri uri = Uri.parse(saved);
            for (UriPermission permission : resolver().getPersistedUriPermissions()) {
                if (!permission.getUri().equals(uri)) continue;
                int flags = 0;
                if (permission.isReadPermission()) flags |= Intent.FLAG_GRANT_READ_URI_PERMISSION;
                if (permission.isWritePermission()) flags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                if (flags != 0) {
                    try {
                        resolver().releasePersistableUriPermission(uri, flags);
                    } catch (SecurityException ignored) {}
                }
            }
        }
        preferences().edit().remove(PREF_TREE_URI).apply();
        clearDocumentCache();
        call.resolve();
    }

    private boolean hasPersistedReadPermission(Uri uri) {
        for (UriPermission permission : resolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(uri) && permission.isReadPermission()) return true;
        }
        return false;
    }

    private JSObject selectionResult(Uri treeUri) throws Exception {
        DocumentInfo root = queryDocument(rootDocumentUri(treeUri), treeUri);
        JSObject out = new JSObject();
        out.put("selected", true);
        out.put("uri", treeUri.toString());
        out.put("name", root.name);
        return out;
    }

    private JSObject notSelected() {
        JSObject out = new JSObject();
        out.put("selected", false);
        return out;
    }

    // ---------------------------------------------------------------- filesystem

    @PluginMethod
    public void readdir(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            DocumentInfo directory = resolve(treeUri, call.getString("path", ""));
            if (!directory.isDirectory()) throw new FileNotFoundException("Directory does not exist");

            JSArray files = new JSArray();
            for (DocumentInfo child : queryChildren(directory.uri, treeUri)) {
                files.put(fileInfo(child));
            }
            JSObject out = new JSObject();
            out.put("files", files);
            call.resolve(out);
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    /**
     * ツリー全体をネイティブ側で走査する。ディレクトリごとに Capacitor Bridge を
     * 往復しないため、大きな Vault の初回表示を大幅に短縮できる。
     */
    @PluginMethod
    public void scanTree(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            String requestedPath = normalizedPath(call.getString("path", ""));
            if (requestedPath.isEmpty() && isCacheFor(treeUri) && documentCacheComplete) {
                call.resolve(cachedTreeResult());
                return;
            }

            DocumentInfo directory = resolve(treeUri, requestedPath);
            if (!directory.isDirectory()) throw new FileNotFoundException("Directory does not exist");

            JSArray files = new JSArray();
            boolean remember = requestedPath.isEmpty();
            if (remember) {
                clearDocumentCache();
                cachedTreeUri = treeUri.toString();
                documentCache.put("", directory);
            }
            appendTree(directory, treeUri, "", files, remember);
            if (remember) documentCacheComplete = true;
            JSObject out = new JSObject();
            out.put("files", files);
            call.resolve(out);
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            DocumentInfo file = resolve(treeUri, requiredPath(call));
            if (file.isDirectory()) throw new FileNotFoundException("File does not exist");

            byte[] bytes;
            try (InputStream input = resolver().openInputStream(file.uri)) {
                if (input == null) throw new FileNotFoundException("File does not exist");
                bytes = readAll(input);
            }

            String encoding = call.getString("encoding");
            JSObject out = new JSObject();
            out.put(
                "data",
                encoding == null
                    ? Base64.encodeToString(bytes, Base64.NO_WRAP)
                    : new String(bytes, StandardCharsets.UTF_8)
            );
            call.resolve(out);
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            String path = requiredPath(call);
            String parentPath = parentPath(path);
            String name = baseName(path);
            boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
            DocumentInfo parent = resolveDirectory(treeUri, parentPath, recursive);
            DocumentInfo file = findChild(parent, name, treeUri);

            if (file == null) {
                Uri created = DocumentsContract.createDocument(resolver(), parent.uri, mimeTypeFor(name), name);
                if (created == null) throw new IllegalStateException("File could not be created: " + path);
                file = queryDocument(created, treeUri);
            } else if (file.isDirectory()) {
                throw new IllegalStateException("Path is a directory: " + path);
            }

            String data = call.getString("data");
            if (data == null) throw new IllegalArgumentException("data is required");
            String encoding = call.getString("encoding");
            byte[] bytes = encoding == null
                ? Base64.decode(data, Base64.DEFAULT)
                : data.getBytes(StandardCharsets.UTF_8);

            try (OutputStream output = resolver().openOutputStream(file.uri, "wt")) {
                if (output == null) throw new FileNotFoundException("File does not exist: " + path);
                output.write(bytes);
            }

            clearDocumentCache();

            JSObject out = new JSObject();
            out.put("uri", file.uri.toString());
            call.resolve(out);
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            String path = requiredPath(call);
            boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
            DocumentInfo parent = resolveDirectory(treeUri, parentPath(path), recursive);
            if (findChild(parent, baseName(path), treeUri) != null) {
                throw new IllegalStateException("Directory already exists: " + path);
            }
            Uri created = DocumentsContract.createDocument(resolver(), parent.uri, MIME_DIRECTORY, baseName(path));
            if (created == null) throw new IllegalStateException("Directory could not be created: " + path);
            clearDocumentCache();
            call.resolve();
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void rmdir(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            DocumentInfo directory = resolve(treeUri, requiredPath(call));
            if (!directory.isDirectory()) throw new FileNotFoundException("Directory does not exist");
            boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
            if (!recursive && !queryChildren(directory.uri, treeUri).isEmpty()) {
                throw new IllegalStateException("Directory is not empty");
            }
            if (!DocumentsContract.deleteDocument(resolver(), directory.uri)) {
                throw new IllegalStateException("Directory could not be deleted");
            }
            clearDocumentCache();
            call.resolve();
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            DocumentInfo file = resolve(treeUri, requiredPath(call));
            if (file.isDirectory()) throw new FileNotFoundException("File does not exist");
            if (!DocumentsContract.deleteDocument(resolver(), file.uri)) {
                throw new IllegalStateException("File could not be deleted");
            }
            clearDocumentCache();
            call.resolve();
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void rename(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            String from = requireString(call, "from");
            String to = requireString(call, "to");
            DocumentInfo source = resolve(treeUri, from);
            DocumentInfo sourceParent = resolve(treeUri, parentPath(from));
            DocumentInfo targetParent = resolve(treeUri, parentPath(to));
            if (findChild(targetParent, baseName(to), treeUri) != null) {
                throw new IllegalStateException("Destination already exists: " + to);
            }

            Uri current = source.uri;
            if (!sourceParent.uri.equals(targetParent.uri)) {
                Uri moved = DocumentsContract.moveDocument(
                    resolver(),
                    current,
                    sourceParent.uri,
                    targetParent.uri
                );
                if (moved == null) throw new IllegalStateException("Document could not be moved");
                current = moved;
            }
            if (!source.name.equals(baseName(to))) {
                Uri renamed = DocumentsContract.renameDocument(resolver(), current, baseName(to));
                if (renamed == null) throw new IllegalStateException("Document could not be renamed");
            }
            clearDocumentCache();
            call.resolve();
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    @PluginMethod
    public void stat(PluginCall call) {
        try {
            Uri treeUri = requireTreeUri();
            call.resolve(fileInfo(resolve(treeUri, call.getString("path", ""))));
        } catch (Exception error) {
            rejectFileError(call, error);
        }
    }

    // ---------------------------------------------------------------- document helpers

    private Uri requireTreeUri() throws FileNotFoundException {
        String saved = preferences().getString(PREF_TREE_URI, null);
        if (saved == null) throw new FileNotFoundException("SAF folder does not exist");
        Uri uri = Uri.parse(saved);
        if (!hasPersistedReadPermission(uri)) throw new SecurityException("SAF permission denied");
        return uri;
    }

    private Uri rootDocumentUri(Uri treeUri) {
        return DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
    }

    private DocumentInfo resolve(Uri treeUri, String path) throws Exception {
        String normalized = normalizedPath(path);
        if (isCacheFor(treeUri) && documentCacheComplete) {
            DocumentInfo cached = documentCache.get(normalized);
            if (cached != null) return cached;
            throw new FileNotFoundException("File does not exist: " + path);
        }

        DocumentInfo current = queryDocument(rootDocumentUri(treeUri), treeUri);
        for (String segment : pathSegments(normalized)) {
            DocumentInfo child = findChild(current, segment, treeUri);
            if (child == null) throw new FileNotFoundException("File does not exist: " + path);
            current = child;
        }
        return current;
    }

    private boolean exists(Uri treeUri, String path) {
        try {
            resolve(treeUri, path);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private DocumentInfo resolveDirectory(Uri treeUri, String path, boolean recursive) throws Exception {
        DocumentInfo current = queryDocument(rootDocumentUri(treeUri), treeUri);
        for (String segment : pathSegments(path)) {
            DocumentInfo child = findChild(current, segment, treeUri);
            if (child == null) {
                if (!recursive) throw new FileNotFoundException("Parent directory does not exist: " + path);
                Uri created = DocumentsContract.createDocument(resolver(), current.uri, MIME_DIRECTORY, segment);
                if (created == null) throw new IllegalStateException("Directory could not be created: " + path);
                child = queryDocument(created, treeUri);
            }
            if (!child.isDirectory()) throw new FileNotFoundException("Directory does not exist: " + path);
            current = child;
        }
        return current;
    }

    private DocumentInfo findChild(DocumentInfo parent, String name, Uri treeUri) throws Exception {
        if (!parent.isDirectory()) return null;
        for (DocumentInfo child : queryChildren(parent.uri, treeUri)) {
            if (child.name.equals(name)) return child;
        }
        return null;
    }

    private List<DocumentInfo> queryChildren(Uri parentUri, Uri treeUri) throws Exception {
        String parentId = DocumentsContract.getDocumentId(parentUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        List<DocumentInfo> children = new ArrayList<>();
        try (Cursor cursor = resolver().query(childrenUri, PROJECTION, null, null, null)) {
            if (cursor == null) throw new FileNotFoundException("Directory does not exist");
            while (cursor.moveToNext()) children.add(fromCursor(cursor, treeUri));
        }
        return children;
    }

    private void appendTree(
        DocumentInfo parent,
        Uri treeUri,
        String prefix,
        JSArray out,
        boolean remember
    ) throws Exception {
        for (DocumentInfo child : queryChildren(parent.uri, treeUri)) {
            String path = prefix.isEmpty() ? child.name : prefix + "/" + child.name;
            JSObject info = fileInfo(child);
            info.put("path", path);
            out.put(info);
            if (remember) documentCache.put(path, child);
            if (child.isDirectory()) appendTree(child, treeUri, path, out, remember);
        }
    }

    private JSObject cachedTreeResult() {
        JSArray files = new JSArray();
        for (Map.Entry<String, DocumentInfo> entry : documentCache.entrySet()) {
            if (entry.getKey().isEmpty()) continue;
            JSObject info = fileInfo(entry.getValue());
            info.put("path", entry.getKey());
            files.put(info);
        }
        JSObject out = new JSObject();
        out.put("files", files);
        return out;
    }

    private boolean isCacheFor(Uri treeUri) {
        return cachedTreeUri != null && cachedTreeUri.equals(treeUri.toString());
    }

    private void clearDocumentCache() {
        documentCache.clear();
        cachedTreeUri = null;
        documentCacheComplete = false;
    }

    private DocumentInfo queryDocument(Uri documentUri, Uri treeUri) throws Exception {
        try (Cursor cursor = resolver().query(documentUri, PROJECTION, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new FileNotFoundException("File does not exist");
            return fromCursor(cursor, treeUri);
        }
    }

    private DocumentInfo fromCursor(Cursor cursor, Uri treeUri) {
        String id = cursor.getString(0);
        String name = cursor.getString(1);
        String mime = cursor.getString(2);
        long size = cursor.isNull(3) ? 0 : cursor.getLong(3);
        long mtime = cursor.isNull(4) ? 0 : cursor.getLong(4);
        Uri uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
        return new DocumentInfo(uri, name == null ? "" : name, mime == null ? "" : mime, size, mtime);
    }

    private JSObject fileInfo(DocumentInfo info) {
        JSObject out = new JSObject();
        out.put("name", info.name);
        out.put("type", info.isDirectory() ? "directory" : "file");
        out.put("size", info.size);
        out.put("mtime", info.mtime);
        out.put("ctime", 0);
        out.put("uri", info.uri.toString());
        return out;
    }

    private List<String> pathSegments(String path) {
        List<String> out = new ArrayList<>();
        if (path == null || path.isBlank()) return out;
        for (String raw : path.replace('\\', '/').split("/")) {
            if (raw.isEmpty() || raw.equals(".")) continue;
            if (raw.equals("..")) throw new IllegalArgumentException("Parent path is not allowed");
            out.add(raw);
        }
        return out;
    }

    private String normalizedPath(String path) {
        return String.join("/", pathSegments(path));
    }

    private String parentPath(String path) {
        List<String> segments = pathSegments(path);
        if (segments.size() <= 1) return "";
        return String.join("/", segments.subList(0, segments.size() - 1));
    }

    private String baseName(String path) {
        List<String> segments = pathSegments(path);
        if (segments.isEmpty()) throw new IllegalArgumentException("Path is required");
        return segments.get(segments.size() - 1);
    }

    private String requiredPath(PluginCall call) {
        return requireString(call, "path");
    }

    private String requireString(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " is required");
        return value;
    }

    private String mimeTypeFor(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        int dot = name.lastIndexOf('.');
        if (dot > 0 && dot < name.length() - 1) {
            String known = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase());
            if (known != null) return known;
        }
        return "application/octet-stream";
    }

    private byte[] readAll(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private void rejectFileError(PluginCall call, Exception error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) message = error.getClass().getSimpleName();
        String code = error instanceof SecurityException ? "SAF_PERMISSION" : "SAF_IO";
        call.reject(message, code, error);
    }
}
