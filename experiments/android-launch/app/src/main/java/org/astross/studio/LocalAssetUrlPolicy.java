package org.astross.studio;

import java.net.URI;

final class LocalAssetUrlPolicy {
    private static final String HOST = "appassets.androidplatform.net";
    private LocalAssetUrlPolicy() {}

    static boolean isLocalOrigin(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost())
                    && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getRawUserInfo() == null;
        } catch (IllegalArgumentException error) { return false; }
    }

    static boolean isAssetUrl(String value) {
        try {
            URI uri = URI.create(value);
            String path = uri.getRawPath();
            if (!isLocalOrigin(value) || path == null || !path.startsWith("/assets/")) return false;
            if (path.indexOf('%') >= 0 || path.indexOf('\\') >= 0 || path.contains("//")) return false;
            for (String segment : path.split("/", -1)) {
                if (".".equals(segment) || "..".equals(segment)) return false;
            }
            return true;
        } catch (IllegalArgumentException error) { return false; }
    }
}
