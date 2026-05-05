package expo.modules.mapboxnavigation

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Módulo Expo (Android) que expõe o Mapbox Navigation SDK v3 ao React Native.
 *
 * A `View` em si vive em `ExpoMapboxNavigationView.kt`. Este arquivo registra:
 *  - Funções globais (`isAvailable`, `getSdkVersion`);
 *  - O view manager + props + eventos.
 */
class ExpoMapboxNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoMapboxNavigation")

    Function("isAvailable") {
      try {
        Class.forName("com.mapbox.navigation.core.MapboxNavigationProvider")
        Class.forName("com.mapbox.maps.MapView")
        true
      } catch (_: Throwable) {
        false
      }
    }

    Function("getSdkVersion") {
      "3.5.0"
    }

    View(ExpoMapboxNavigationView::class) {
      Events(
        "onRouteProgress",
        "onReroute",
        "onArrival",
        "onWaypointArrival",
        "onOffRoute",
        "onCancel",
        "onReady"
      )

      Prop("waypoints") { view: ExpoMapboxNavigationView, raw: List<Map<String, Any?>> ->
        view.updateWaypoints(raw)
      }
      Prop("routeCoordinates") { view: ExpoMapboxNavigationView, raw: List<Map<String, Any?>>? ->
        view.updateRouteCoordinates(raw ?: emptyList())
      }
      Prop("accessToken") { view: ExpoMapboxNavigationView, token: String? ->
        view.updateAccessToken(token)
      }
      Prop("profile") { view: ExpoMapboxNavigationView, profile: String ->
        view.updateProfile(profile)
      }
      Prop("voiceLanguage") { view: ExpoMapboxNavigationView, language: String ->
        view.updateVoiceLanguage(language)
      }
      Prop("simulateRoute") { view: ExpoMapboxNavigationView, simulate: Boolean ->
        view.updateSimulateRoute(simulate)
      }
      Prop("mute") { view: ExpoMapboxNavigationView, mute: Boolean ->
        view.updateMute(mute)
      }
      Prop("cameraMode") { view: ExpoMapboxNavigationView, mode: String ->
        view.updateCameraMode(mode)
      }
      Prop("routeLineColor") { view: ExpoMapboxNavigationView, color: String? ->
        view.updateRouteLineColor(color)
      }
      Prop("hideManeuverBanner") { view: ExpoMapboxNavigationView, hidden: Boolean ->
        view.updateHideManeuverBanner(hidden)
      }
      Prop("hideBottomPanel") { view: ExpoMapboxNavigationView, hidden: Boolean ->
        view.updateHideBottomPanel(hidden)
      }
      Prop("followingPaddingTop") { view: ExpoMapboxNavigationView, v: Double? ->
        view.updateFollowingPaddingTopDp(v)
      }
      Prop("followingPaddingBottom") { view: ExpoMapboxNavigationView, v: Double? ->
        view.updateFollowingPaddingBottomDp(v)
      }
      Prop("followingPaddingLeft") { view: ExpoMapboxNavigationView, v: Double? ->
        view.updateFollowingPaddingLeftDp(v)
      }
      Prop("followingPaddingRight") { view: ExpoMapboxNavigationView, v: Double? ->
        view.updateFollowingPaddingRightDp(v)
      }
      Prop("followingZoom") { view: ExpoMapboxNavigationView, v: Double? ->
        view.updateFollowingZoom(v)
      }
      Prop("recenterRequestKey") { view: ExpoMapboxNavigationView, v: Int? ->
        view.updateRecenterRequestKey(v)
      }
    }
  }
}
