package org.astross.studio;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.TreeMap;
import java.util.HashMap;
import org.apache.commons.codec.digest.Blake3;

/** Strict parser and path-set verifier for the build-generated Cloudflare manifest. */
final class CloudflareArtifactManifest {
    static final String FILE_PATH="__astro_static_studio/cloudflare-manifest.v2.json";
    static final String ASSET_IDENTITY="pages-blake3-base64-content-plus-extension-prefix32-v1";
    static final int MAX_MANIFEST_BYTES=1024*1024;
    final String sourceRevision,workflowRevision;
    final Map<String,Asset> assets;

    static final class Asset {final String pagesHash,sha256;Asset(String pagesHash,String sha256){this.pagesHash=pagesHash;this.sha256=sha256;}}
    private CloudflareArtifactManifest(String sourceRevision,String workflowRevision,Map<String,Asset> assets){this.sourceRevision=sourceRevision;this.workflowRevision=workflowRevision;this.assets=Collections.unmodifiableMap(new TreeMap<>(assets));}

    static CloudflareArtifactManifest from(GithubArtifactArchive.VerifiedSite site)throws Exception{
        if(site==null)throw invalid("The verified static artifact is missing.");
        Map<String,byte[]> files=new HashMap<>(site.files());byte[] raw=files.remove(FILE_PATH);
        if(raw==null||raw.length==0||raw.length>MAX_MANIFEST_BYTES)throw invalid("The required build-generated Cloudflare manifest is missing or too large.");
        String json;
        try{json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();}
        catch(CharacterCodingException error){throw invalid("The Cloudflare manifest is not valid UTF-8.");}
        Parser parser=new Parser(json);Parsed parsed=parser.parse();
        if(parsed.schemaVersion!=2||!ASSET_IDENTITY.equals(parsed.assetIdentity)||!isRevision(parsed.sourceRevision)||!isRevision(parsed.workflowRevision))throw invalid("The Cloudflare manifest version, asset identity, or source revisions are invalid.");
        if(parsed.assets.isEmpty()||parsed.assets.size()>GithubArtifactArchive.MAX_ENTRIES||parsed.assets.size()!=files.size())throw invalid("The Cloudflare manifest does not match the verified static files.");
        for(Map.Entry<String,Asset> item:parsed.assets.entrySet()){
            String path=item.getKey();Asset asset=item.getValue();
            GithubArtifactArchive.validateRelativeFilePath(path);
            if(path.equals("__astro_static_studio")||path.startsWith("__astro_static_studio/"))throw invalid("The reserved Studio metadata path cannot be a public site asset.");
            if(!asset.pagesHash.matches("[0-9a-f]{32}")||!asset.sha256.matches("[0-9a-f]{64}"))throw invalid("The Cloudflare manifest contains an invalid asset digest.");
            if(!files.containsKey(path))throw invalid("The Cloudflare manifest references a file missing from the verified artifact.");
            if(!MessageDigest.isEqual(decodeHex(asset.sha256),sha256(files.get(path))))throw invalid("An artifact file does not match its build-generated SHA-256 digest.");
            if(!MessageDigest.isEqual(asset.pagesHash.getBytes(StandardCharsets.US_ASCII),pagesHash(files.get(path),path).getBytes(StandardCharsets.US_ASCII)))throw invalid("An artifact file does not match its build-generated Pages hash.");
        }
        for(String path:files.keySet())if(!parsed.assets.containsKey(path))throw invalid("The verified artifact contains a file absent from the Cloudflare manifest.");
        if(!parsed.assets.containsKey("index.html"))throw invalid("The Cloudflare manifest does not include the root index.html.");
        Map<String,AssetSignature> byHash=new HashMap<>();
        for(Map.Entry<String,Asset> item:parsed.assets.entrySet()){
            byte[] content=files.get(item.getKey());String extension=extension(item.getKey());AssetSignature previous=byHash.get(item.getValue().pagesHash);
            if(previous!=null&&(!previous.extension.equals(extension)||!Arrays.equals(previous.content,content)))throw invalid("Different files in the manifest share one Cloudflare asset key.");
            if(previous==null)byHash.put(item.getValue().pagesHash,new AssetSignature(extension,content));
        }
        return new CloudflareArtifactManifest(parsed.sourceRevision,parsed.workflowRevision,parsed.assets);
    }

    private static boolean isRevision(String value){return value!=null&&value.matches("[0-9a-f]{40}");}
    static String pagesHash(byte[] contents,String path){
        String encoded=Base64.getEncoder().encodeToString(contents)+extension(path);
        byte[] hash=Blake3.hash(encoded.getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder(hash.length*2);
        for(byte value:hash)hex.append(Character.forDigit((value>>>4)&15,16)).append(Character.forDigit(value&15,16));
        return hex.substring(0,32);
    }
    private static byte[] sha256(byte[] value)throws Exception{return MessageDigest.getInstance("SHA-256").digest(value);}
    private static byte[] decodeHex(String value){byte[] output=new byte[value.length()/2];for(int index=0;index<output.length;index++)output[index]=(byte)Integer.parseInt(value.substring(index*2,index*2+2),16);return output;}
    private static String extension(String path){int slash=path.lastIndexOf('/'),dot=path.lastIndexOf('.');if(dot<=slash||dot==slash+1&&path.length()>dot+1)return "";return path.substring(dot+1);}
    private static SecurityException invalid(String detail){return new SecurityException(detail);}
    private static final class AssetSignature {final String extension;final byte[] content;AssetSignature(String extension,byte[] content){this.extension=extension;this.content=content;}}
    private static final class Parsed {int schemaVersion=-1;String assetIdentity="",sourceRevision="",workflowRevision="";final Map<String,Asset> assets=new TreeMap<>();}

    /** Minimal strict JSON reader: only the declared object schema is accepted; duplicate keys fail closed. */
    private static final class Parser {
        final String source;int offset;
        Parser(String source){this.source=source;}
        Parsed parse()throws Exception{
            Parsed result=new Parsed();skip();expect('{');boolean version=false,identity=false,sourcePresent=false,workflow=false,assets=false;skip();
            while(!take('}')){
                String key=string();skip();expect(':');skip();
                if("schemaVersion".equals(key)){if(version)throw invalid("Duplicate Cloudflare manifest field.");version=true;result.schemaVersion=integer();}
                else if("assetIdentity".equals(key)){if(identity)throw invalid("Duplicate Cloudflare manifest field.");identity=true;result.assetIdentity=string();}
                else if("sourceRevision".equals(key)){if(sourcePresent)throw invalid("Duplicate Cloudflare manifest field.");sourcePresent=true;result.sourceRevision=string();}
                else if("workflowRevision".equals(key)){if(workflow)throw invalid("Duplicate Cloudflare manifest field.");workflow=true;result.workflowRevision=string();}
                else if("assets".equals(key)){if(assets)throw invalid("Duplicate Cloudflare manifest field.");assets=true;readAssets(result.assets);}
                else throw invalid("The Cloudflare manifest contains an unsupported field.");
                skip();if(take('}'))break;expect(',');skip();
            }
            skip();if(offset!=source.length()||!version||!identity||!sourcePresent||!workflow||!assets)throw invalid("The Cloudflare manifest is incomplete or has trailing data.");return result;
        }
        private void readAssets(Map<String,Asset> output)throws Exception{
            expect('{');skip();if(take('}'))return;
            while(true){String path=string();skip();expect(':');skip();Asset asset=readAsset();if(output.put(path,asset)!=null)throw invalid("The Cloudflare manifest contains a duplicate asset path.");skip();if(take('}'))return;expect(',');skip();}
        }
        private Asset readAsset()throws Exception{
            expect('{');skip();boolean pages=false,sha=false;String pagesHash="",sha256="";
            while(!take('}')){String key=string();skip();expect(':');skip();if("pagesHash".equals(key)){if(pages)throw invalid("Duplicate asset digest field.");pages=true;pagesHash=string();}
                else if("sha256".equals(key)){if(sha)throw invalid("Duplicate asset digest field.");sha=true;sha256=string();}else throw invalid("The asset manifest contains an unsupported field.");
                skip();if(take('}'))break;expect(',');skip();}
            if(!pages||!sha)throw invalid("The Cloudflare asset manifest is missing a required digest.");return new Asset(pagesHash,sha256);
        }
        private int integer()throws Exception{
            int start=offset;if(offset>=source.length()||!Character.isDigit(source.charAt(offset)))throw invalid("Cloudflare manifest schemaVersion must be an integer.");
            if(source.charAt(offset)=='0'){offset++;if(offset<source.length()&&Character.isDigit(source.charAt(offset)))throw invalid("Invalid Cloudflare manifest integer.");}
            else while(offset<source.length()&&Character.isDigit(source.charAt(offset)))offset++;
            try{return Integer.parseInt(source.substring(start,offset));}catch(NumberFormatException error){throw invalid("Cloudflare manifest schemaVersion is outside the supported range.");}
        }
        private String string()throws Exception{
            expect('"');StringBuilder value=new StringBuilder();
            while(offset<source.length()){
                char current=source.charAt(offset++);if(current=='"')return value.toString();
                if(current<' ')throw invalid("The Cloudflare manifest contains a control character.");
                if(current=='\\'){
                    if(offset>=source.length())throw invalid("The Cloudflare manifest string is incomplete.");char escape=source.charAt(offset++);
                    switch(escape){case '"':value.append('"');break;case '\\':value.append('\\');break;case '/':value.append('/');break;case 'b':value.append('\b');break;case 'f':value.append('\f');break;case 'n':value.append('\n');break;case 'r':value.append('\r');break;case 't':value.append('\t');break;case 'u':appendUnicode(value);break;default:throw invalid("The Cloudflare manifest contains an invalid JSON escape.");}
                }else if(Character.isHighSurrogate(current)){
                    if(offset>=source.length()||!Character.isLowSurrogate(source.charAt(offset)))throw invalid("The Cloudflare manifest contains invalid Unicode.");value.append(current).append(source.charAt(offset++));
                }else if(Character.isLowSurrogate(current))throw invalid("The Cloudflare manifest contains invalid Unicode.");else value.append(current);
            }
            throw invalid("The Cloudflare manifest string is not terminated.");
        }
        private void appendUnicode(StringBuilder value)throws Exception{
            char first=hexChar();if(Character.isHighSurrogate(first)){if(offset+2>source.length()||source.charAt(offset)!='\\'||source.charAt(offset+1)!='u')throw invalid("The Cloudflare manifest contains invalid Unicode.");offset+=2;char second=hexChar();if(!Character.isLowSurrogate(second))throw invalid("The Cloudflare manifest contains invalid Unicode.");value.append(first).append(second);}
            else if(Character.isLowSurrogate(first))throw invalid("The Cloudflare manifest contains invalid Unicode.");else value.append(first);
        }
        private char hexChar()throws Exception{if(offset+4>source.length())throw invalid("The Cloudflare manifest contains an incomplete Unicode escape.");int value=0;for(int i=0;i<4;i++){int digit=Character.digit(source.charAt(offset++),16);if(digit<0)throw invalid("The Cloudflare manifest contains an invalid Unicode escape.");value=(value<<4)|digit;}return (char)value;}
        private void skip(){while(offset<source.length()){char c=source.charAt(offset);if(c==' '||c=='\n'||c=='\r'||c=='\t')offset++;else break;}}
        private boolean take(char expected){if(offset<source.length()&&source.charAt(offset)==expected){offset++;return true;}return false;}
        private void expect(char expected)throws Exception{if(!take(expected))throw invalid("The Cloudflare manifest JSON structure is invalid.");}
    }
}
