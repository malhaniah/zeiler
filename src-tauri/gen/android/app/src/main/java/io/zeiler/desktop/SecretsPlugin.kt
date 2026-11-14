package io.zeiler.desktop

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

@InvokeArg
class SecretArgs {
  lateinit var account: String
  var secret: String? = null
}

@TauriPlugin
class SecretsPlugin(private val activity: Activity) : Plugin(activity) {
  private val preferences = activity.getSharedPreferences("zeiler.secrets", Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  @Command
  fun get(invoke: Invoke) {
    try {
      val account = invoke.parseArgs(SecretArgs::class.java).account
      val encoded = preferences.getString(account, null)
      val secret = encoded?.let {
        val bytes = Base64.decode(it, Base64.NO_WRAP)
        require(bytes.size > GCM_IV_BYTES) { "Invalid encrypted secret" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, bytes, 0, GCM_IV_BYTES))
        String(cipher.doFinal(bytes, GCM_IV_BYTES, bytes.size - GCM_IV_BYTES), Charsets.UTF_8)
      }
      invoke.resolve(JSObject().put("secret", secret ?: JSONObject.NULL))
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Could not read the Android Keystore")
    }
  }

  @Command
  fun set(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecretArgs::class.java)
      val secret = args.secret ?: throw IllegalArgumentException("A secret is required")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val encrypted = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
      val stored = cipher.iv + encrypted
      preferences.edit().putString(args.account, Base64.encodeToString(stored, Base64.NO_WRAP)).apply()
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Could not write to the Android Keystore")
    }
  }

  @Command
  fun delete(invoke: Invoke) {
    try {
      val account = invoke.parseArgs(SecretArgs::class.java).account
      preferences.edit().remove(account).apply()
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Could not delete the Android Keystore entry")
    }
  }

  companion object {
    private const val KEY_ALIAS = "zeiler.secrets.v1"
    private const val GCM_IV_BYTES = 12
    private const val GCM_TAG_BITS = 128
  }
}
