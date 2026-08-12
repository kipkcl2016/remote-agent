package com.remoteagent.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureCredentials")
public class SecureCredentialsPlugin extends Plugin {
    private static final String KEY_ALIAS = "remote_agent_gateway_credentials";
    private static final String PREFERENCES = "remote_agent_secure_credentials";
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void get(PluginCall call) {
        String key = validatedKey(call);
        if (key == null) return;
        String encoded = preferences().getString(key, null);
        JSObject result = new JSObject();
        if (encoded == null) {
            result.put("value", JSObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            result.put("value", decrypt(encoded));
            call.resolve(result);
        } catch (Exception error) {
            preferences().edit().remove(key).apply();
            call.reject("Unable to read secure credential", "KEYSTORE_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = validatedKey(call);
        if (key == null) return;
        String value = call.getString("value");
        int maxBytes = "remote-agent.gateway.connections.v1".equals(key) ? 32768 : 4096;
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > maxBytes) {
            call.reject("value is required and exceeds the secure storage limit", "INVALID_VALUE");
            return;
        }
        try {
            preferences().edit().putString(key, encrypt(value)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to store secure credential", "KEYSTORE_WRITE_FAILED", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = validatedKey(call);
        if (key == null) return;
        preferences().edit().remove(key).apply();
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private String validatedKey(PluginCall call) {
        String key = call.getString("key");
        if (!"remote-agent.gateway.url".equals(key)
            && !"remote-agent.gateway.token".equals(key)
            && !"remote-agent.gateway.connections.v1".equals(key)) {
            call.reject("Unsupported credential key", "INVALID_KEY");
            return null;
        }
        return key;
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .setKeySize(256)
         .build());
        return generator.generateKey();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteBuffer packed = ByteBuffer.allocate(4 + iv.length + ciphertext.length);
        packed.putInt(iv.length).put(iv).put(ciphertext);
        return Base64.encodeToString(packed.array(), Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        ByteBuffer packed = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP));
        int ivLength = packed.getInt();
        if (ivLength < 12 || ivLength > 16 || packed.remaining() <= ivLength) {
            throw new IllegalArgumentException("Invalid encrypted credential");
        }
        byte[] iv = new byte[ivLength];
        packed.get(iv);
        byte[] ciphertext = new byte[packed.remaining()];
        packed.get(ciphertext);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }
}
