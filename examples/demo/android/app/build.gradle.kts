plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vuenative.demo"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.franciscodlx.socialauth.vndemo"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        // Hot-reload endpoint for debug builds. Overridable per invocation:
        // `./gradlew -PdevServerUrl=ws://10.0.2.2:9000 ...`, which is what
        // `vue-native run android --port 9000` passes. 10.0.2.2 is the
        // emulator's alias for the host machine's loopback.
        buildConfigField(
            "String",
            "DEV_SERVER_URL",
            "\"" + (project.findProperty("devServerUrl") as String? ?: "ws://10.0.2.2:8174") + "\"",
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":VueNativeCore"))
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.core:core-ktx:1.15.0")
}
