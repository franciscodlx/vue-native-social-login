pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
    // :VueNativeCore reads its dependency versions from the vendored catalog.
    versionCatalogs {
        create("libs") {
            from(files("../native/android/gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "demo"
include(":app")
include(":VueNativeCore")
project(":VueNativeCore").projectDir = file("../native/android/VueNativeCore")
