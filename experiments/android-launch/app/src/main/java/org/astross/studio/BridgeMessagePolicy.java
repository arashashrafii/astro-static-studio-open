package org.astross.studio;

final class BridgeMessagePolicy {
    private BridgeMessagePolicy(){}
    static boolean isAllowed(String origin,boolean mainFrame){
        return mainFrame&&"https://appassets.androidplatform.net".equals(origin);
    }
    static boolean isActionAllowed(String action){return "begin".equals(action)||"status".equals(action)||"logout".equals(action)||"installApp".equals(action)||"createProject".equals(action)||"checkInstallation".equals(action)||"readContent".equals(action)||"saveContent".equals(action);}
}
