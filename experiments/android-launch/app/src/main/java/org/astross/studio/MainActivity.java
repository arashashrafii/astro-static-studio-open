package org.astross.studio;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.Nullable;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ENTRY="https://appassets.androidplatform.net/assets/www/index.html";
    private static final String GITHUB_APP_INSTALL_URL="https://github.com/apps/astro-studio-arash-test/installations/new";
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newCachedThreadPool();
    private final AuthGeneration generation=new AuthGeneration();
    private final AuthAttemptController attempts=new AuthAttemptController(generation);
    private final ProjectOperationCoordinator projectOperations=new ProjectOperationCoordinator(attempts);
    private WebView webView;
    private GithubAuthBridge auth;

    @Override protected void onCreate(@Nullable Bundle state){
        super.onCreate(state);getWindow().setStatusBarColor(Color.rgb(245,243,237));getWindow().setNavigationBarColor(Color.BLACK);
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            android.widget.TextView unavailable=new android.widget.TextView(this);
            unavailable.setText("Update Android System WebView to use secure GitHub sign-in.");
            unavailable.setTextSize(18);unavailable.setPadding(40,40,40,40);setContentView(unavailable);return;
        }
        webView=new WebView(this);webView.setLayoutParams(new ViewGroup.LayoutParams(-1,-1));
        WebSettings settings=webView.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        auth=new GithubAuthBridge();
        WebViewCompat.addWebMessageListener(webView,"StudioNativeAuth",Collections.singleton("https://appassets.androidplatform.net"),
                (view,message,sourceOrigin,isMainFrame,replyProxy)->handleBridgeMessage(message.getData(),sourceOrigin.toString(),isMainFrame,replyProxy));
        webView.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return intercept(loader,request);}
            @SuppressWarnings("deprecation") @Override public WebResourceResponse shouldInterceptRequest(WebView view,String url){
                if(isAndroidApiUrl(url))return previewUnavailable();
                if(!LocalAssetUrlPolicy.isAssetUrl(url))return blocked();
                return loader.shouldInterceptRequest(Uri.parse(url));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !isAllowedDocument(request.getUrl().toString());}
            @SuppressWarnings("deprecation") @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !isAllowedDocument(url);}
            private WebResourceResponse intercept(WebViewAssetLoader assetLoader,WebResourceRequest request){
                String url=request.getUrl().toString();if(isAndroidApiUrl(url))return previewUnavailable();
                if(!LocalAssetUrlPolicy.isAssetUrl(url))return blocked();return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        setContentView(webView);webView.loadUrl(ENTRY);auth.restore();
    }

    private boolean isAndroidApiUrl(String value){
        if(!LocalAssetUrlPolicy.isLocalOrigin(value))return false;
        String path=Uri.parse(value).getPath();return path!=null&&path.startsWith("/api/");
    }
    private boolean isAllowedDocument(String value){return LocalAssetUrlPolicy.isAssetUrl(value);}
    private WebResourceResponse blocked(){return response("text/plain","Blocked by the Android app security policy.",403);}
    private WebResourceResponse previewUnavailable(){return response("application/json","{\"error\":\"GitHub content sync is not connected in this Android preview build.\"}",503);}
    private WebResourceResponse response(String type,String body,int status){
        return new WebResourceResponse(type,"UTF-8",status,status==503?"Service Unavailable":"Blocked",java.util.Collections.singletonMap("Cache-Control","no-store"),
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
    private void notifyPage(){runOnUiThread(()->{if(webView!=null)webView.evaluateJavascript("window.dispatchEvent(new Event('studio-native-auth-change'))",null);});}
    private void handleBridgeMessage(String raw,String origin,boolean isMainFrame,JavaScriptReplyProxy reply){
        if(!BridgeMessagePolicy.isAllowed(origin,isMainFrame)||raw==null||raw.length()>GithubProjectClient.MAX_CONTENT_BYTES+2048)return;
        try{
            JSONObject request=new JSONObject(raw);String action=request.optString("action","");
            if(!BridgeMessagePolicy.isActionAllowed(action))return;
            if("status".equals(action)){
                String requestId=request.optString("requestId","");if(requestId.isEmpty()||requestId.length()>64)return;
                reply.postMessage(new JSONObject().put("source","studio-native-auth").put("requestId",requestId)
                        .put("status",new JSONObject(auth.status())).toString());
            }else if("begin".equals(action))auth.begin();
            else if("logout".equals(action))auth.logout();
            else if("installApp".equals(action))auth.openInstallation();
            else if("createProject".equals(action)){String requestId=validRequestId(request);if(requestId!=null)auth.createProject(request.optString("name",""),requestId,reply);}
            else if("checkInstallation".equals(action)){String requestId=validRequestId(request);if(requestId!=null)auth.checkInstallation(requestId,reply);}
            else if("readContent".equals(action)){String requestId=validRequestId(request);if(requestId!=null)auth.readContent(requestId,reply);}
            else if("saveContent".equals(action)){String requestId=validRequestId(request);JSONObject content=request.optJSONObject("content");String expectedSha=request.optString("expectedSha","");if(requestId!=null&&content!=null)auth.saveContent(content,expectedSha,requestId,reply);}
        }catch(Exception ignored){}
    }
    private String validRequestId(JSONObject request){String requestId=request.optString("requestId","");return requestId.matches("[A-Za-z0-9_-]{1,64}")?requestId:null;}
    private void sendProjectReply(JavaScriptReplyProxy reply,String requestId,JSONObject result){
        try{main.post(()->{if(webView==null)return;try{reply.postMessage(new JSONObject().put("source","studio-native-project").put("requestId",requestId).put("result",result).toString());}catch(Exception ignored){}});}catch(Exception ignored){}
    }

    private final class GithubAuthBridge {
        private final GithubTokenStore store=new GithubTokenStore(MainActivity.this);
        private volatile String state="checking",login="",userCode="",message="";
        private volatile long userId;
        private volatile boolean clearing;
        private volatile String projectState="none",projectMessage="";
        private volatile GithubProjectClient.Binding projectBinding;
        private volatile String projectSha="";

        String status(){
            try{return new JSONObject().put("state",state).put("login",login).put("userCode",userCode).put("message",message)
                    .put("project",new JSONObject().put("state",projectState).put("owner",projectBinding==null?"":projectBinding.owner)
                            .put("name",projectBinding==null?"":projectBinding.name).put("message",projectMessage)).toString();}
            catch(Exception error){return "{\"state\":\"error\",\"message\":\"Could not read sign-in status.\"}";}
        }
        void begin(){
            if(BuildConfig.GITHUB_APP_CLIENT_ID.trim().isEmpty()){set("error","","","GitHub sign-in is not configured in this build.");return;}
            final boolean verifyOnly;final long ticket;
            synchronized(this){
                if(clearing||"authorized".equals(state))return;
                verifyOnly="verification_pending".equals(state);
                ticket=attempts.begin();if(ticket<0)return;
                set(verifyOnly?"checking":"pending","","",verifyOnly?"Checking the saved GitHub authorization and account identity…":"Preparing secure GitHub approval…");
            }
            if(verifyOnly){
                worker.execute(()->verifySaved(ticket));return;
            }
            worker.execute(()->authorize(ticket));
        }
        private void authorize(long ticket){
            try{
                GithubDeviceFlow.Tokens tokens=new GithubDeviceFlow().authorize(BuildConfig.GITHUB_APP_CLIENT_ID,
                        (code,address,expires)->{
                            if(!attempts.isCurrent(ticket))return;
                            setIfCurrent(ticket,"pending","",code,"Enter the displayed code in the GitHub page.");
                            main.post(()->{
                                synchronized(GithubAuthBridge.this){
                                    if(!attempts.isCurrent(ticket))return;
                                    try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(address)));}
                                    catch(RuntimeException error){set("error","","","No browser is available to open GitHub.");}
                                }
                            });
                        },()->!attempts.isCurrent(ticket));
                if(tokens==null||!attempts.isCurrent(ticket))return;
                long now=System.currentTimeMillis(),accessExpiry=now+tokens.expiresIn*1000,refreshExpiry=now+tokens.refreshExpiresIn*1000;
                if(!attempts.runIfCurrent(ticket,()->store.save(tokens.accessToken,tokens.refreshToken,"",accessExpiry,refreshExpiry)))return;
                set("checking","","","GitHub approved this app. Verifying your account identity…");
                final GithubDeviceFlow.UserIdentity identity;
                try{identity=GithubDeviceFlow.authenticatedIdentity(tokens.accessToken);}
                catch(Exception error){setIfCurrent(ticket,"verification_pending","","","GitHub authorization is saved securely, but account identity could not be verified. Check your connection and retry.");return;}
                if(!attempts.runIfCurrent(ticket,()->{store.save(tokens.accessToken,tokens.refreshToken,identity.login,accessExpiry,refreshExpiry);store.saveIdentityId(identity.login,identity.id);}))return;
                userId=identity.id;restoreProject(tokens.accessToken,identity.login,identity.id,ticket);
                setIfCurrent(ticket,"authorized",identity.login,"","GitHub account verified and authorization encrypted on this device.");
            }catch(Exception error){setIfCurrent(ticket,"error","","",safeMessage(error));}
            finally{attempts.finish(ticket);}
        }
        void logout(){
            synchronized(this){if(clearing||"creating".equals(projectState))return;clearing=true;set("checking","","","Clearing local authorization…");}
            worker.execute(()->{try{projectOperations.cancelAndRunCleanup(()->{store.clear();return null;});synchronized(this){clearing=false;projectBinding=null;projectSha="";userId=0;projectState="none";projectMessage="";set("signed_out","","","Local sign-out complete. Provider approval must be revoked in GitHub settings.");}}
                catch(Exception error){synchronized(this){clearing=false;set("error","","","Could not clear local authorization.");}}});
        }
        void openInstallation(){
            synchronized(this){if(!"authorized".equals(state)||clearing)return;}
            try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(GITHUB_APP_INSTALL_URL)));}
            catch(RuntimeException error){set("authorized",login,"","Could not open the GitHub installation page. Open GitHub and search for Astro Studio Arash Test, then return here to recheck.");}
        }
        void restore(){
            if(!store.hasCredentials()){set("signed_out","","","");return;}
            long ticket=attempts.begin();if(ticket<0)return;
            worker.execute(()->verifySaved(ticket));
        }
        private void verifySaved(long ticket){
            try{
                JSONObject saved=store.read();if(saved==null)throw new IllegalStateException("Saved GitHub authorization is missing.");
                GithubTokenRefresh.Result result=GithubTokenRefresh.restore(saved,System.currentTimeMillis(),BuildConfig.GITHUB_APP_CLIENT_ID,
                        generation,ticket,(client,refresh)->new GithubDeviceFlow().refresh(client,refresh),
                        GithubDeviceFlow::authenticatedLogin,store::save);
                if(result.cancelled||!attempts.isCurrent(ticket))return;
                if(result.login.isEmpty())setIfCurrent(ticket,"verification_pending","","","Authorization is stored securely, but GitHub account identity is not verified. Retry the check before continuing.");
                else{JSONObject current=store.read();GithubDeviceFlow.UserIdentity identity=GithubDeviceFlow.authenticatedIdentity(current.optString("access_token",""));long prior=current.optLong("user_id",0);if(prior>0&&prior!=identity.id)throw new IllegalStateException("GitHub account identity changed. Reconnect the original account before continuing.");store.saveIdentityId(identity.login,identity.id);userId=identity.id;restoreProject(current.optString("access_token",""),identity.login,identity.id,ticket);setIfCurrent(ticket,"authorized",identity.login,"","GitHub account verified and authorization encrypted on this device.");}
            }catch(Exception error){setIfCurrent(ticket,"error","","",safeMessage(error));}
            finally{attempts.finish(ticket);}
        }
        private synchronized void setIfCurrent(long ticket,String next,String name,String code,String detail){if(attempts.isCurrent(ticket))set(next,name,code,detail);}
        private synchronized void set(String next,String name,String code,String detail){
            if("authorized".equals(next)&&(name==null||name.isEmpty())){next="verification_pending";detail="GitHub account identity could not be verified. Retry the check before continuing.";}
            state=next;login=name==null?"":name;userCode=code==null?"":code;message=detail==null?"":detail;notifyPage();
        }
        private GithubProjectClient.Binding storedProject()throws Exception{return store.readProject();}
        private void restoreProject(String access,String account,long ownerId,long ticket){
            try{
                GithubProjectClient.Binding binding=storedProject();if(binding==null){projectBinding=null;projectSha="";projectState="none";projectMessage="";return;}
                projectBinding=binding;projectState="checking";projectMessage="Checking the saved private project…";notifyPage();
                projectOperations.run(ticket,()->{GithubProjectClient client=projectClient(ticket);client.verify(binding,access,account,ownerId);if(binding.ownerId!=ownerId)throw new IllegalStateException("Saved private project belongs to a different GitHub account.");GithubProjectClient.Content current=client.readContent(binding,access);
                    if(current==null)throw new IllegalStateException("The site's canonical content file is missing. Existing repository files were left unchanged.");
                    store.markProjectInitialized();
                    if(!projectOperations.isCurrent(ticket))return null;projectSha=current.sha;projectState="ready";projectMessage="Private project connected.";notifyPage();return null;});
            }catch(Exception error){if(attempts.isCurrent(ticket)){projectState="error";projectMessage=safeMessage(error);notifyPage();}}
        }
        void createProject(String name,String requestId,JavaScriptReplyProxy reply){
            final long ticket;
            synchronized(this){if(!"authorized".equals(state)||clearing){sendProjectReply(reply,requestId,errorReply(new IllegalStateException("Verify your GitHub account before creating a project.")));return;}
                try{GithubProjectClient.validateRepositoryName(name);}catch(Exception error){sendProjectReply(reply,requestId,errorReply(error));return;}
                try{GithubProjectClient.Binding saved=storedProject();if(saved!=null&&!saved.name.equals(name)){sendProjectReply(reply,requestId,errorReply(new IllegalStateException("A private project is already connected on this device.")));return;}}catch(Exception error){sendProjectReply(reply,requestId,errorReply(error));return;}
                ticket=projectOperations.begin();if(ticket<0){sendProjectReply(reply,requestId,errorReply(new IllegalStateException("Another GitHub operation is still in progress.")));return;}projectState="creating";projectMessage="Creating the confirmed private repository…";notifyPage();}
            worker.execute(()->{try{projectOperations.run(ticket,()->{String access=validAccessToken(ticket);GithubProjectClient client=projectClient(ticket);GithubProjectClient.Binding binding=storedProject();
                    if(binding==null){
                        if(store.hasCreateIntent(name,userId))throw new IllegalStateException("A previous creation request may have reached GitHub. The app will not submit it again; check the repository in GitHub and contact support if it is absent.");
                        try{binding=client.createPrivate(access,login,name,userId,()->store.saveCreateIntent(login,name,userId));}
                        catch(Exception createError){if(createError instanceof GithubProjectClient.ApiException&&((GithubProjectClient.ApiException)createError).status>=400&&((GithubProjectClient.ApiException)createError).status<500)store.clearCreateIntent(name,userId);throw createError;}
                        store.saveProject(binding);store.clearCreateIntent(name,userId);projectBinding=binding;
                    }
                    client.verify(binding,access,login,userId);GithubProjectClient.Content content=client.readContent(binding,access);
                    if(content==null)throw new IllegalStateException("The reviewed site template did not provide its canonical content file. Existing repository files were left unchanged.");
                    store.markProjectInitialized();
                    if(!projectOperations.isCurrent(ticket))return null;projectSha=content.sha;projectState="ready";projectMessage="Private site created from the approved template and canonical content verified.";sendProjectReply(reply,requestId,new JSONObject().put("ok",true).put("project",new JSONObject().put("owner",binding.owner).put("name",binding.name).put("sha",content.sha)));notifyPage();return null;});}
                catch(Exception error){if(projectOperations.isCurrent(ticket)){requireReauthorization(error);projectState="error";projectMessage=safeMessage(error);sendProjectReply(reply,requestId,errorReply(error));notifyPage();}}
                finally{projectOperations.finish(ticket);}});
        }
        void readContent(String requestId,JavaScriptReplyProxy reply){projectOperation(requestId,reply,ticket->{
            GithubProjectClient.Binding binding=storedProject();if(binding==null)throw new IllegalStateException("Create a private project before editing its content.");
            String access=validAccessToken(ticket);GithubProjectClient.Content content=projectClient(ticket).readContentVerified(binding,access,login,userId);
            if(content==null)throw new IllegalStateException("Project content is missing. Retry project setup; no existing files will be overwritten.");
            projectSha=content.sha;return new JSONObject().put("content",content.value).put("sha",content.sha);
        });}
        void checkInstallation(String requestId,JavaScriptReplyProxy reply){projectOperation(requestId,reply,ticket->{
            String access=validAccessToken(ticket);
            String result=projectClient(ticket).checkCurrentInstallation(access,login,userId);
            return new JSONObject().put("message",result);
        });}
        void saveContent(JSONObject content,String expectedSha,String requestId,JavaScriptReplyProxy reply){projectOperation(requestId,reply,ticket->{
            GithubProjectClient.Binding binding=storedProject();if(binding==null)throw new IllegalStateException("Create a private project before saving content.");
            String access=validAccessToken(ticket);GithubProjectClient.Content saved=projectClient(ticket).saveContentVerified(binding,access,login,userId,expectedSha,content);
            projectSha=saved.sha;projectState="ready";return new JSONObject().put("content",saved.value).put("sha",saved.sha);
        });}
        interface ProjectWork{JSONObject run(long ticket)throws Exception;}
        private void projectOperation(String requestId,JavaScriptReplyProxy reply,ProjectWork work){
            final long ticket; synchronized(this){if(!"authorized".equals(state)||clearing){sendProjectReply(reply,requestId,errorReply(new IllegalStateException("GitHub authorization must be verified before project access.")));return;}ticket=projectOperations.begin();if(ticket<0){sendProjectReply(reply,requestId,errorReply(new IllegalStateException("Another GitHub operation is still in progress.")));return;}}
            worker.execute(()->{try{JSONObject result=projectOperations.run(ticket,()->work.run(ticket));if(projectOperations.isCurrent(ticket))sendProjectReply(reply,requestId,result);}
                catch(GithubProjectClient.ConflictException error){if(projectOperations.isCurrent(ticket)){JSONObject conflict=errorReply(error);try{if(error.remote!=null)conflict.put("conflict",error.remote.json());}catch(Exception ignored){}sendProjectReply(reply,requestId,conflict);}}
                catch(Exception error){if(projectOperations.isCurrent(ticket)){requireReauthorization(error);sendProjectReply(reply,requestId,errorReply(error));}}
                finally{projectOperations.finish(ticket);}});
        }
        private String validAccessToken(long ticket)throws Exception{
            if(!projectOperations.isCurrent(ticket)||clearing)throw new IllegalStateException("GitHub operation was cancelled.");
            JSONObject record=store.read();if(record==null)throw new IllegalStateException("GitHub authorization is missing; sign in again.");
            if(record.optLong("expires_at",0)<=System.currentTimeMillis()+60000){
                final GithubTokenRefresh.Result refreshed;
                try{refreshed=GithubTokenRefresh.restore(record,System.currentTimeMillis(),BuildConfig.GITHUB_APP_CLIENT_ID,generation,ticket,
                        (client,refresh)->new GithubDeviceFlow().refresh(client,refresh),GithubDeviceFlow::authenticatedLogin,store::save);}
                catch(Exception error){set("verification_pending","","","GitHub authorization expired or could not be verified. Retry sign-in before using this project.");throw error;}
                if(refreshed.cancelled||!login.equalsIgnoreCase(refreshed.login)){set("verification_pending","","","GitHub authorization needs to be verified again before using this project.");throw new IllegalStateException("GitHub authorization needs to be verified again before using this project.");}
                record=store.read();if(record==null)throw new IllegalStateException("GitHub authorization is missing; sign in again.");
            }
            return record.optString("access_token","");
        }
        private GithubProjectClient projectClient(long ticket){try{return new GithubProjectClient(projectOperations.requestGuard(ticket),GithubContentValidator.from(getAssets().open("native-validation/content.schema.json"),getAssets().open("native-validation/content-invariants.json")));}catch(Exception e){throw new IllegalStateException("Canonical content validation is unavailable.",e);}}
        private void requireReauthorization(Exception error){if(error instanceof GithubProjectClient.ApiException&&((GithubProjectClient.ApiException)error).status==401)set("verification_pending","","","GitHub rejected the saved authorization. Verify it again before continuing.");}
        private JSONObject errorReply(Exception error){JSONObject result=new JSONObject();try{result.put("error",safeMessage(error));}catch(Exception ignored){}return result;}
        private String safeMessage(Exception error){return error.getMessage()==null?"GitHub sign-in failed. Check your connection and try again.":error.getMessage();}
    }

    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(webView!=null){WebViewCompat.removeWebMessageListener(webView,"StudioNativeAuth");webView.destroy();webView=null;}worker.shutdownNow();super.onDestroy();}
}
