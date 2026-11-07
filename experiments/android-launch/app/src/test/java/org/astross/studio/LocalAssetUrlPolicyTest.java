package org.astross.studio;

import org.junit.Test;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class LocalAssetUrlPolicyTest {
    @Test public void acceptsOnlyTheBundledAssetOriginAndPorts(){
        assertTrue(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets/www/index.html"));
        assertTrue(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net:443/assets/www/index.html"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net:8443/assets/www/index.html"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("http://appassets.androidplatform.net/assets/www/index.html"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://user@appassets.androidplatform.net/assets/www/index.html"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net.evil.test/assets/www/index.html"));
    }
    @Test public void rejectsNavigationOutsideAssetRoot(){
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/api/content"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://github.com/login/device"));
    }
    @Test public void rejectsEncodedAndAmbiguousTraversal(){
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets/%2e%2e/private"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets/%2E%2E/private"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets/%2fprivate"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets/%252e%252e/private"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets/../private"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets//private"));
        assertFalse(LocalAssetUrlPolicy.isAssetUrl("https://appassets.androidplatform.net/assets\\private"));
    }
}
