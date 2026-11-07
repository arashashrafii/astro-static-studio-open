package org.astross.studio;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class GithubTokenStore {
    private static final String ALIAS="astro-studio-github-token-v2";
    private static final String PREFS="github-auth-v2";
    private static final String KEY="encrypted-record";
    private final Context context;
    GithubTokenStore(Context context){this.context=context.getApplicationContext();}

    synchronized void save(String access,String refresh,String login,long accessExpiry,long refreshExpiry)throws Exception{
        write(GithubCredentialRecord.withTokens(read(),access,refresh,login,accessExpiry,refreshExpiry));
    }
    synchronized void saveIdentityId(String login,long userId)throws Exception{write(GithubCredentialRecord.withUserId(read(),login,userId));}
    synchronized void saveCreateIntent(String owner,String name,long ownerId)throws Exception{
        JSONObject record=read();if(record==null||!owner.equalsIgnoreCase(record.optString("login",""))||ownerId!=record.optLong("user_id",0))throw new IllegalStateException("Verified GitHub account is required.");
        String prior=record.optString("create_intent_name","");if(!prior.isEmpty()&&(!prior.equals(name)||record.optLong("create_intent_owner_id",0)!=ownerId))throw new IllegalStateException("A previous repository creation needs manual reconciliation before another attempt.");
        record.put("create_intent_name",name).put("create_intent_owner_id",ownerId);write(record);
    }
    synchronized boolean hasCreateIntent(String name,long ownerId)throws Exception{JSONObject record=read();return record!=null&&!record.optString("create_intent_name","").isEmpty()&&ownerId==record.optLong("create_intent_owner_id",0);}
    synchronized void clearCreateIntent(String name,long ownerId)throws Exception{JSONObject record=read();if(record!=null&&name.equals(record.optString("create_intent_name",""))&&ownerId==record.optLong("create_intent_owner_id",0)){record.remove("create_intent_name");record.remove("create_intent_owner_id");write(record);}}
    synchronized void saveProject(GithubProjectClient.Binding binding)throws Exception{
        JSONObject record=read();if(record==null)throw new IllegalStateException("Sign in before saving a GitHub project.");
        if(!binding.owner.equalsIgnoreCase(record.optString("login",""))||binding.ownerId!=record.optLong("user_id",0))throw new IllegalArgumentException("Project owner does not match the verified GitHub account.");
        boolean same=record.optLong("project_id",0)==binding.id;
        record.put("project_id",binding.id).put("project_owner",binding.owner).put("project_owner_id",binding.ownerId).put("project_name",binding.name).put("project_branch",binding.branch);
        if(!same)record.put("project_initialized",false);write(record);
    }
    synchronized GithubProjectClient.Binding readProject()throws Exception{
        JSONObject record=read();if(record==null||!record.has("project_id"))return null;
        return new GithubProjectClient.Binding(record.getLong("project_id"),record.getLong("project_owner_id"),record.getString("project_owner"),record.getString("project_name"),record.getString("project_branch"));
    }
    synchronized boolean isProjectInitialized()throws Exception{JSONObject record=read();return record!=null&&record.optBoolean("project_initialized",false);}
    synchronized void markProjectInitialized()throws Exception{JSONObject record=read();if(record==null||!record.has("project_id"))throw new IllegalStateException("The private project binding is missing.");record.put("project_initialized",true);write(record);}
    private void write(JSONObject record)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        String value=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+"."+
                Base64.encodeToString(cipher.doFinal(record.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
        if(!context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(KEY,value).commit())
            throw new IllegalStateException("Secure token storage failed");
    }
    synchronized boolean hasCredentials(){try{return GithubCredentialRecord.hasCredentials(read());}catch(Exception error){return false;}}
    synchronized JSONObject read()throws Exception{
        String value=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getString(KEY,null);if(value==null)return null;
        String[] parts=value.split("\\.",-1);if(parts.length!=2)throw new IllegalStateException("Saved GitHub authorization is damaged");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    synchronized void clear()throws Exception{
        SharedPreferences prefs=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
        JSONObject record=GithubCredentialRecord.clearCredentials(read());
        if(record!=null){write(record);
        }else{
            if(!prefs.edit().remove(KEY).commit())throw new IllegalStateException("Local sign-out could not clear credentials");
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias(ALIAS))store.deleteEntry(ALIAS);
        }
    }
    private SecretKey key()throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());return generator.generateKey();
    }
}
