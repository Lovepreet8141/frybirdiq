plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "tech.frybirdiq.pos"
    compileSdk = 35

    defaultConfig {
        applicationId = "tech.frybirdiq.pos"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.3.0"

        // The only origin the printer bridge is exposed to. Change it here and nowhere else.
        buildConfigField("String", "POS_ORIGIN", "\"https://frybirdiq.tech\"")
        buildConfigField("String", "POS_PATH", "\"/app/pos\"")
        buildConfigField("String", "BRIDGE_VERSION", "\"1.3.0\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    // WebViewCompat.addWebMessageListener — the origin-restricted bridge.
    implementation("androidx.webkit:webkit:1.12.1")
}
