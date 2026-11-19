package io.zeiler.desktop

import android.app.Activity
import android.app.UiModeManager
import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

fun isAndroidTv(activity: Activity): Boolean {
  val uiMode = activity.getSystemService(UiModeManager::class.java)
  return uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
}

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }
}
