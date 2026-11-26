package com.vuenative.demo

import com.vuenative.core.VueNativeActivity

class MainActivity : VueNativeActivity() {
    override fun getBundleAssetPath(): String {
        return "vue-native-bundle.js"
    }

    override fun getDevServerUrl(): String? {
        return if (BuildConfig.DEBUG) BuildConfig.DEV_SERVER_URL else null
    }
}
