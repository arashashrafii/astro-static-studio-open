package org.astross.studio;

import org.junit.Test;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class BridgeMessagePolicyTest {
    @Test public void acceptsOnlyTopLevelBundledDashboardOrigin(){
        assertTrue(BridgeMessagePolicy.isAllowed("https://appassets.androidplatform.net",true));
        assertFalse(BridgeMessagePolicy.isAllowed("https://appassets.androidplatform.net",false));
        assertFalse(BridgeMessagePolicy.isAllowed("https://appassets.androidplatform.net:8443",true));
        assertFalse(BridgeMessagePolicy.isAllowed("https://evil.example",true));
        assertFalse(BridgeMessagePolicy.isAllowed("null",true));
    }
    @Test public void exposesOnlyExpectedBridgeActions(){
        assertTrue(BridgeMessagePolicy.isActionAllowed("begin"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("status"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("logout"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("installApp"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("createProject"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("checkInstallation"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("readContent"));
        assertTrue(BridgeMessagePolicy.isActionAllowed("saveContent"));
        assertFalse(BridgeMessagePolicy.isActionAllowed("getToken"));
        assertFalse(BridgeMessagePolicy.isActionAllowed("request"));
        assertFalse(BridgeMessagePolicy.isActionAllowed("githubProxy"));
        assertFalse(BridgeMessagePolicy.isActionAllowed("readPreferences"));
    }
}
