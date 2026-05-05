package expo.modules.mapboxnavigation

import android.Manifest
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import com.mapbox.api.directions.v5.models.RouteOptions
import com.mapbox.bindgen.Expected
import com.mapbox.common.MapboxOptions
import com.mapbox.geojson.Point
import com.mapbox.maps.CameraOptions
import com.mapbox.maps.EdgeInsets
import com.mapbox.maps.MapInitOptions
import com.mapbox.maps.MapView
import com.mapbox.maps.Style
import com.mapbox.maps.ImageHolder
import com.mapbox.maps.plugin.LocationPuck2D
import com.mapbox.maps.plugin.PuckBearing
import com.mapbox.maps.plugin.animation.camera
import com.mapbox.maps.plugin.locationcomponent.OnIndicatorPositionChangedListener
import com.mapbox.maps.plugin.locationcomponent.location
import com.mapbox.navigation.base.extensions.applyDefaultNavigationOptions
import com.mapbox.navigation.base.options.NavigationOptions
import com.mapbox.navigation.base.route.NavigationRoute
import com.mapbox.navigation.base.route.NavigationRouterCallback
import com.mapbox.navigation.base.route.RouterFailure
import com.mapbox.navigation.base.trip.model.RouteProgress
import com.mapbox.navigation.base.trip.model.RouteProgressState
import com.mapbox.navigation.core.MapboxNavigation
import com.mapbox.navigation.core.MapboxNavigationProvider
import com.mapbox.navigation.core.directions.session.RoutesObserver
import com.mapbox.navigation.core.formatter.MapboxDistanceFormatter
import com.mapbox.navigation.core.trip.session.LocationMatcherResult
import com.mapbox.navigation.core.trip.session.LocationObserver
import com.mapbox.navigation.core.trip.session.RouteProgressObserver
import com.mapbox.navigation.core.trip.session.VoiceInstructionsObserver
import com.mapbox.navigation.base.formatter.DistanceFormatterOptions
import com.mapbox.navigation.tripdata.maneuver.api.MapboxManeuverApi
import com.mapbox.navigation.ui.base.util.MapboxNavigationConsumer
import com.mapbox.navigation.ui.components.maneuver.view.MapboxManeuverView
import com.mapbox.navigation.ui.maps.camera.NavigationCamera
import com.mapbox.navigation.ui.maps.camera.data.MapboxNavigationViewportDataSource
import com.mapbox.navigation.ui.maps.location.NavigationLocationProvider
import com.mapbox.navigation.ui.maps.route.line.api.MapboxRouteLineApi
import com.mapbox.navigation.ui.maps.route.line.api.MapboxRouteLineView
import com.mapbox.navigation.ui.maps.route.line.model.MapboxRouteLineApiOptions
import com.mapbox.navigation.ui.maps.route.line.model.MapboxRouteLineViewOptions
import com.mapbox.navigation.ui.maps.route.line.model.RouteLineColorResources
import com.mapbox.navigation.voice.api.MapboxSpeechApi
import com.mapbox.navigation.voice.api.MapboxVoiceInstructionsPlayer
import com.mapbox.navigation.voice.model.SpeechAnnouncement
import com.mapbox.navigation.voice.model.SpeechError
import com.mapbox.navigation.voice.model.SpeechValue
import com.mapbox.navigation.voice.model.SpeechVolume
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.text.Normalizer

/**
 * View nativa Android baseada no Mapbox Navigation SDK v3.
 *
 * A UI é composta pelos blocos oficiais do SDK: Maps SDK (`MapView`), route line,
 * navigation camera, location matcher e `MapboxNavigation` para rota/progresso.
 * Os overlays React continuam acima desta view no wrapper JS.
 */
class ExpoMapboxNavigationView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  val onRouteProgress by EventDispatcher()
  val onReroute by EventDispatcher()
  val onArrival by EventDispatcher()
  val onWaypointArrival by EventDispatcher()
  val onOffRoute by EventDispatcher()
  val onCancel by EventDispatcher()
  val onReady by EventDispatcher()

  // Estado pendente (cache até o SDK estar pronto).
  private var pendingWaypoints: List<Map<String, Any?>> = emptyList()
  private var pendingRouteCoordinates: List<Map<String, Any?>> = emptyList()
  private var pendingAccessToken: String? = null
  private var pendingProfile: String = "driving-traffic"
  private var pendingVoiceLanguage: String = "pt-BR"
  private var pendingSimulateRoute: Boolean = false
  private var pendingMute: Boolean = false
  private var pendingCameraMode: String = "following"
  private var pendingRouteLineColor: String? = null
  private var pendingHideManeuverBanner: Boolean = false
  private var pendingHideBottomPanel: Boolean = false

  /** Padding lógico em **dp** (valores vindos do RN; multiplicamos por `density`). */
  private var followingPadTopDp: Double = 120.0
  private var followingPadStartDp: Double = 40.0
  private var followingPadBottomDp: Double = 220.0
  private var followingPadEndDp: Double = 40.0
  private var pendingFollowingZoom: Double? = null
  private var lastRecenterRequestKey: Int? = null

  private var mapView: MapView? = null
  private var mapboxNavigation: MapboxNavigation? = null
  private var viewportDataSource: MapboxNavigationViewportDataSource? = null
  private var navigationCamera: NavigationCamera? = null
  private var routeLineApi: MapboxRouteLineApi? = null
  private var routeLineView: MapboxRouteLineView? = null
  private var maneuverApi: MapboxManeuverApi? = null
  private var maneuverView: MapboxManeuverView? = null
  private var speechApi: MapboxSpeechApi? = null
  private var voiceInstructionsPlayer: MapboxVoiceInstructionsPlayer? = null
  private val navigationLocationProvider = NavigationLocationProvider()
  private var indicatorPositionListener: OnIndicatorPositionChangedListener? = null
  private var lastSpokenVoiceKey: String? = null
  private val puckTransitionOptions: (ValueAnimator.() -> Unit) = {
    duration = PUCK_ANIMATION_DURATION_MS
    interpolator = LinearInterpolator()
  }
  private val speechCallback =
    MapboxNavigationConsumer<Expected<SpeechError, SpeechValue>> { expected ->
      if (pendingMute) return@MapboxNavigationConsumer
      val player = voiceInstructionsPlayer ?: return@MapboxNavigationConsumer
      expected.fold(
        { error ->
          player.play(error.fallback, voiceInstructionsPlayerCallback)
        },
        { value ->
          player.play(value.announcement, voiceInstructionsPlayerCallback)
        },
      )
    }
  private val voiceInstructionsPlayerCallback =
    MapboxNavigationConsumer<SpeechAnnouncement> { announcement ->
      speechApi?.clean(announcement)
    }
  private val voiceInstructionsObserver = VoiceInstructionsObserver { voiceInstructions ->
    if (pendingMute) return@VoiceInstructionsObserver
    val voiceKey = voiceInstructionKey(voiceInstructions.announcement())
    if (voiceKey != null && voiceKey == lastSpokenVoiceKey) return@VoiceInstructionsObserver
    lastSpokenVoiceKey = voiceKey
    speechApi?.generate(voiceInstructions, speechCallback)
  }

  private companion object {
    /** Pitch padrão estilo Waze; equilibra perspectiva vs estabilidade. */
    const val WAZE_LIKE_PITCH = 45.0

    /**
     * Id da layer do puck nativo do `LocationComponent` (constante exposta
     * pelo SDK em `LocationComponentConstants.LOCATION_INDICATOR_LAYER`).
     * Usamos para reposicionar o puck acima da route line.
     */
    const val LOCATION_INDICATOR_LAYER = "mapbox-location-indicator-layer"

    /** Dourado (mesma identidade visual da rota fora do SDK em `ActiveTripScreen`). */
    const val ROUTE_GOLD_COLOR = "#C9A227"

    /** Tom mais escuro do mesmo dourado para o casing — dá leitura sobre fundo claro. */
    const val ROUTE_GOLD_CASING_COLOR = "#8A7016"

    /** Trecho percorrido (vanishing): cinza com baixa opacidade — fica "apagado". */
    const val ROUTE_TRAVELED_COLOR = "#3300008C"
    const val ROUTE_TRAVELED_CASING_COLOR = "#22000000"

    /** Mantém seta e bearing em movimento contínuo entre updates reais de GPS. */
    const val PUCK_ANIMATION_DURATION_MS = 1_000L

    const val MANEUVER_BANNER_MARGIN_DP = 12
    const val MAX_DIRECTIONS_COORDINATES = 25
  }
  private var lastEnhancedLocation: com.mapbox.common.location.Location? = null
  private var lastCompletedLegIndex: Int? = null
  private var didEmitOffRoute = false
  private var hasSetInitialRoute = false

  private val routesObserver = RoutesObserver { routeUpdateResult ->
    val routes = routeUpdateResult.navigationRoutes
    if (routes.isEmpty()) return@RoutesObserver
    if (hasSetInitialRoute) {
      onReroute(mapOf("reason" to "off-route"))
    } else {
      hasSetInitialRoute = true
    }
    val mv = mapView ?: return@RoutesObserver
    routeLineApi?.setNavigationRoutes(routes) { value ->
      mv.mapboxMap.style?.let { style ->
        routeLineView?.renderRouteDrawData(style, value)
        // O SDK desenha por padrão pinos de origem e destino na route line —
        // o que aparecia como o "ponto branco" sobre o início da rota.
        // Escondemos a layer inteira; o motorista já é representado pelo
        // puck nativo do `LocationComponent` (configurado em
        // `attachNavigationViewIfNeeded`).
        routeLineView?.hideOriginAndDestinationPoints(style)
        // A route line adiciona seus layers no topo. Reposicionamos
        // o puck do motorista acima dela para evitar que a seta seja
        // encoberta pela polyline azul.
        bringPuckToTop(style)
      }
    }
    viewportDataSource?.onRouteChanged(routes.first())
    viewportDataSource?.evaluate()
    navigationCamera?.requestNavigationCameraToFollowing()
  }

  private val locationObserver = object : LocationObserver {
    override fun onNewRawLocation(rawLocation: com.mapbox.common.location.Location) = Unit

    override fun onNewLocationMatcherResult(locationMatcherResult: LocationMatcherResult) {
      val enhancedLocation = locationMatcherResult.enhancedLocation
      lastEnhancedLocation = enhancedLocation
      // O `NavigationLocationProvider` recebe `keyPoints` (subdivisão da
      // diferença entre o último update e o novo). O `LocationComponent`
      // os consome para interpolar posição e bearing em ~60 fps —
      // origem real da fluidez Waze-like na seta do motorista.
      navigationLocationProvider.changePosition(
        location = enhancedLocation,
        keyPoints = locationMatcherResult.keyPoints,
        latLngTransitionOptions = puckTransitionOptions,
        bearingTransitionOptions = puckTransitionOptions,
      )
      // O `viewportDataSource` calcula a câmera ideal (center + zoom +
      // pitch) com easing interno; a `NavigationCamera` aplica.
      viewportDataSource?.onLocationChanged(enhancedLocation)
      viewportDataSource?.evaluate()
      // Não chamamos `requestNavigationCameraToFollowing()` por tick —
      // basta a transição inicial; tick a tick gera reset de animação
      // e produz a sensação de "travado".
    }
  }

  private val routeProgressObserver = RouteProgressObserver { progress ->
    val state = progress.currentState
    renderManeuverBanner(progress)

    if (state == RouteProgressState.OFF_ROUTE || state == RouteProgressState.UNCERTAIN) {
      if (!didEmitOffRoute) {
        didEmitOffRoute = true
        onOffRoute(mapOf("distanceMeters" to 0.0))
      }
    } else {
      didEmitOffRoute = false
    }

    // Sincroniza o estado interno da `routeLineApi` com o progress da
    // rota (legs/alternates/restrictions). O trim visual da vanishing
    // line é feito a 60 fps em `OnIndicatorPositionChangedListener`,
    // não aqui — este observer roda a 1 Hz e bastaria para o trim.
    routeLineApi?.updateWithRouteProgress(progress) { _ ->
      mapView?.mapboxMap?.style?.let { style ->
        // Safety-net: se um reroute parcial recriar layers, mantemos o
        // puck no topo para a seta do motorista nunca ser encoberta.
        bringPuckToTop(style)
      }
    }

    val legIndex = progress.currentLegProgress?.legIndex ?: 0
    if (state == RouteProgressState.COMPLETE && lastCompletedLegIndex != legIndex) {
      lastCompletedLegIndex = legIndex
      val finalLeg = legIndex >= pendingWaypoints.size - 2
      val payload = mapOf(
        "waypointIndex" to (legIndex + 1),
        "isFinalDestination" to finalLeg,
      )
      if (finalLeg) onArrival(payload) else onWaypointArrival(payload)
    }

    val progressPayload = mutableMapOf<String, Any>(
        "distanceRemainingMeters" to progress.distanceRemaining.toDouble(),
        "durationRemainingSeconds" to progress.durationRemaining.toDouble(),
        "distanceTraveledMeters" to progress.distanceTraveled.toDouble(),
        "fractionTraveled" to progress.fractionTraveled.toDouble(),
    )
    progress.currentLegProgress
      ?.currentStepProgress
      ?.distanceRemaining
      ?.toDouble()
      ?.let { progressPayload["upcomingManeuverDistanceMeters"] = it }
    val maneuver = currentManeuverPayload(progress)
    maneuver.text?.let { progressPayload["upcomingManeuverText"] = it }
    maneuver.type?.let { progressPayload["upcomingManeuverType"] = it }
    onRouteProgress(progressPayload)
  }

  init {
    setBackgroundColor(Color.BLACK)
    layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT,
    )
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attachNavigationViewIfNeeded()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    detachNavigationView()
  }

  // ----------------------------------------------------------------------
  // Prop setters
  // ----------------------------------------------------------------------

  fun updateWaypoints(raw: List<Map<String, Any?>>) {
    pendingWaypoints = raw
    rebuildRouteIfNeeded()
  }

  fun updateRouteCoordinates(raw: List<Map<String, Any?>>) {
    pendingRouteCoordinates = raw
    rebuildRouteIfNeeded()
  }

  fun updateAccessToken(token: String?) {
    pendingAccessToken = token?.trim()?.takeIf { it.isNotBlank() }
    applyAccessToken()
  }

  fun updateProfile(profile: String) {
    pendingProfile = profile
    rebuildRouteIfNeeded()
  }

  fun updateVoiceLanguage(language: String) {
    val normalized = language.trim().takeIf { it.isNotBlank() } ?: "pt-BR"
    if (pendingVoiceLanguage == normalized) return
    pendingVoiceLanguage = normalized
    if (mapView != null) setupVoiceComponents()
    rebuildRouteIfNeeded()
  }

  fun updateSimulateRoute(simulate: Boolean) {
    pendingSimulateRoute = simulate
  }

  fun updateMute(mute: Boolean) {
    pendingMute = mute
    applyVoiceVolume()
    if (mute) {
      speechApi?.cancel()
      lastSpokenVoiceKey = null
    }
  }

  fun updateCameraMode(mode: String) {
    pendingCameraMode = mode
    when (mode) {
      "following" -> navigationCamera?.requestNavigationCameraToFollowing()
      "overview" -> navigationCamera?.requestNavigationCameraToOverview()
    }
  }

  fun updateRouteLineColor(hex: String?) {
    pendingRouteLineColor = hex
  }

  fun updateHideManeuverBanner(hidden: Boolean) {
    pendingHideManeuverBanner = hidden
    updateManeuverBannerVisibility()
  }

  fun updateHideBottomPanel(hidden: Boolean) {
    pendingHideBottomPanel = hidden
    // navigationView?.customizeViewOptions { showInfoPanelInFreeDrive = !hidden }
  }

  fun updateFollowingPaddingTopDp(value: Double?) {
    if (value != null) followingPadTopDp = value
    applyFollowingPaddingInsets()
  }

  fun updateFollowingPaddingBottomDp(value: Double?) {
    if (value != null) followingPadBottomDp = value
    applyFollowingPaddingInsets()
  }

  fun updateFollowingPaddingLeftDp(value: Double?) {
    if (value != null) followingPadStartDp = value
    applyFollowingPaddingInsets()
  }

  fun updateFollowingPaddingRightDp(value: Double?) {
    if (value != null) followingPadEndDp = value
    applyFollowingPaddingInsets()
  }

  fun updateFollowingZoom(value: Double?) {
    pendingFollowingZoom = value
    applyFollowingZoom()
  }

  fun updateRecenterRequestKey(value: Int?) {
    if (value == null || value == lastRecenterRequestKey) return
    lastRecenterRequestKey = value
    pendingCameraMode = "following"
    applyFollowingZoom()
    viewportDataSource?.evaluate()
    // `requestNavigationCameraToFollowing` faz a transição animada do
    // SDK até o estado de tracking suave — é exatamente o efeito Waze.
    navigationCamera?.requestNavigationCameraToFollowing()
  }

  // ----------------------------------------------------------------------
  // SDK lifecycle
  // ----------------------------------------------------------------------

  private fun applyFollowingPaddingInsets() {
    val ds = viewportDataSource ?: return
    val d = resources.displayMetrics.density.toDouble()
    ds.followingPadding =
      EdgeInsets(
        followingPadTopDp * d,
        followingPadStartDp * d,
        followingPadBottomDp * d,
        followingPadEndDp * d,
      )
    ds.evaluate()
  }

  private fun applyFollowingZoom() {
    val ds = viewportDataSource ?: return
    ds.followingZoomPropertyOverride(pendingFollowingZoom)
    // Pitch fixo no estilo Waze. 45° dá perspectiva clara da próxima
    // manobra sem amplificar jitter de GPS como pitches mais agressivos.
    ds.followingPitchPropertyOverride(WAZE_LIKE_PITCH)
    ds.evaluate()
  }

  /**
   * Move a layer do puck do `LocationComponent` para o topo da pilha de
   * style, garantindo que a seta do motorista renderize acima da route
   * line. `Style.moveStyleLayer(id, null)` em SDK v11 envia a layer
   * para o final da lista (= topmost).
   */
  private fun bringPuckToTop(style: Style) {
    if (!style.styleLayerExists(LOCATION_INDICATOR_LAYER)) return
    runCatching { style.moveStyleLayer(LOCATION_INDICATOR_LAYER, null) }
  }

  private fun renderManeuverBanner(progress: RouteProgress) {
    val view = maneuverView ?: return
    if (pendingHideManeuverBanner) {
      view.visibility = View.GONE
      return
    }

    val maneuvers = maneuverApi?.getManeuvers(progress) ?: return
    maneuvers.fold(
      {
        view.visibility = View.GONE
      },
      {
        view.visibility = View.VISIBLE
        view.renderManeuvers(maneuvers)
      },
    )
  }

  private data class ManeuverPayload(val text: String?, val type: String?)

  private fun currentManeuverPayload(progress: RouteProgress): ManeuverPayload {
    val step = progress.currentLegProgress?.currentStepProgress?.step
    val primary = step?.bannerInstructions()?.firstOrNull()?.primary()
    return ManeuverPayload(
      text = primary?.text() ?: step?.maneuver()?.instruction(),
      type = primary?.type() ?: step?.maneuver()?.type(),
    )
  }

  private fun updateManeuverBannerVisibility() {
    maneuverView?.visibility = if (pendingHideManeuverBanner) View.GONE else View.INVISIBLE
  }

  private fun setupVoiceComponents() {
    speechApi?.cancel()
    voiceInstructionsPlayer?.shutdown()
    speechApi = MapboxSpeechApi(context.applicationContext, pendingVoiceLanguage)
    voiceInstructionsPlayer = MapboxVoiceInstructionsPlayer(context.applicationContext, pendingVoiceLanguage)
    applyVoiceVolume()
  }

  private fun applyVoiceVolume() {
    voiceInstructionsPlayer?.volume(SpeechVolume(if (pendingMute) 0f else 1f))
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun voiceInstructionKey(announcement: String?): String? {
    val normalized = announcement
      ?.let { Normalizer.normalize(it, Normalizer.Form.NFD) }
      ?.replace("\\p{Mn}+".toRegex(), "")
      ?.lowercase()
      ?.replace("\\b(em|daqui a)\\s+\\d+([,.]\\d+)?\\s*(m|metros?|km|quilometros?)\\b".toRegex(), " ")
      ?.replace("\\b\\d+([,.]\\d+)?\\s*(m|metros?|km|quilometros?)\\b".toRegex(), " ")
      ?.replace("[^a-z0-9\\s]".toRegex(), " ")
      ?.replace("\\s+".toRegex(), " ")
      ?.trim()
      ?.takeIf { it.isNotBlank() }

    return normalized
      ?.substringAfterLast(" na ", normalized)
      ?.substringAfterLast(" no ", normalized)
      ?.substringAfterLast(" para ", normalized)
      ?.substringAfterLast(" pela ", normalized)
      ?.substringAfterLast(" pelo ", normalized)
      ?.take(80)
  }

  private fun attachNavigationViewIfNeeded() {
    if (mapView != null) return
    applyAccessToken()

    val first = pendingWaypoints.firstValidPoint()
    val mv = MapView(
      context,
      MapInitOptions(
        context,
        cameraOptions = CameraOptions.Builder()
          .center(first ?: Point.fromLngLat(-46.6333, -23.5505))
          .zoom(15.0)
          .build(),
      )
    )
    mv.layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT,
    )
    addView(mv)
    mapView = mv

    val formatterOptions = DistanceFormatterOptions.Builder(context.applicationContext).build()
    maneuverApi = MapboxManeuverApi(MapboxDistanceFormatter(formatterOptions))
    maneuverView = MapboxManeuverView(context).apply {
      visibility = if (pendingHideManeuverBanner) View.GONE else View.INVISIBLE
    }
    addView(
      maneuverView,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.TOP,
      ).apply {
        val margin = dp(MANEUVER_BANNER_MARGIN_DP)
        topMargin = margin
        marginStart = margin
        marginEnd = margin
      },
    )

    setupVoiceComponents()

    mv.location.apply {
      setLocationProvider(navigationLocationProvider)
      // Seta custom como `bearingImage`: o `LocationComponent` interpola
      // posição (via `keyPoints`) e bearing entre updates de GPS,
      // produzindo a fluidez Waze-like a 60 fps a partir de 1 Hz.
      // O bitmap aponta para o norte; o componente rotaciona conforme
      // `puckBearing` (= COURSE: direção do movimento).
      val arrowBitmap = ImageHolder.from(DriverArrowBitmap.create(resources.displayMetrics))
      locationPuck = LocationPuck2D(
        topImage = null,
        bearingImage = arrowBitmap,
        shadowImage = null,
      )
      enabled = true
      puckBearingEnabled = true
      puckBearing = PuckBearing.COURSE
      pulsingEnabled = false
      showAccuracyRing = false
    }

    viewportDataSource = MapboxNavigationViewportDataSource(mv.mapboxMap)
    applyFollowingPaddingInsets()
    applyFollowingZoom()
    navigationCamera = NavigationCamera(mv.mapboxMap, mv.camera, viewportDataSource!!)
    // `vanishingRouteLineEnabled` faz a linha "consumir" o trecho já
    // percorrido em tempo real (efeito Waze característico). A
    // atualização visual fluida (60 fps) acontece via
    // `OnIndicatorPositionChangedListener` registrado abaixo —
    // o `routeProgressObserver` (1 Hz) cuida apenas dos eventos de leg.
    routeLineApi = MapboxRouteLineApi(
      MapboxRouteLineApiOptions.Builder()
        .vanishingRouteLineEnabled(true)
        .build(),
    )

    val routeColors = RouteLineColorResources.Builder()
      .routeDefaultColor(Color.parseColor(ROUTE_GOLD_COLOR))
      .routeUnknownCongestionColor(Color.parseColor(ROUTE_GOLD_COLOR))
      .routeLowCongestionColor(Color.parseColor(ROUTE_GOLD_COLOR))
      .routeModerateCongestionColor(Color.parseColor(ROUTE_GOLD_COLOR))
      .routeHeavyCongestionColor(Color.parseColor(ROUTE_GOLD_COLOR))
      .routeSevereCongestionColor(Color.parseColor(ROUTE_GOLD_COLOR))
      .routeCasingColor(Color.parseColor(ROUTE_GOLD_CASING_COLOR))
      .routeLineTraveledColor(Color.parseColor(ROUTE_TRAVELED_COLOR))
      .routeLineTraveledCasingColor(Color.parseColor(ROUTE_TRAVELED_CASING_COLOR))
      .build()
    routeLineView = MapboxRouteLineView(
      MapboxRouteLineViewOptions.Builder(context)
        .routeLineColorResources(routeColors)
        .build(),
    )

    // Listener de alta frequência: o `LocationComponent` interpola a
    // posição entre updates de GPS e dispara este callback a ~60 fps.
    // Usamos para recalcular o "trim" da rota visualmente em tempo real.
    val listener = OnIndicatorPositionChangedListener { point ->
      val api = routeLineApi ?: return@OnIndicatorPositionChangedListener
      val view = routeLineView ?: return@OnIndicatorPositionChangedListener
      val style = mapView?.mapboxMap?.style ?: return@OnIndicatorPositionChangedListener
      val update = api.updateTraveledRouteLine(point)
      view.renderRouteLineUpdate(style, update)
    }
    indicatorPositionListener = listener
    mv.location.addOnIndicatorPositionChangedListener(listener)

    mv.mapboxMap.loadStyle(Style.MAPBOX_STREETS) {
      requestRouteIfNeeded()
      onReady(emptyMap<String, Any>())
    }

    try {
      mapboxNavigation = MapboxNavigationProvider.create(NavigationOptions.Builder(context).build())
    } catch (e: Throwable) {
      onCancel(mapOf("reason" to "error", "message" to (e.message ?: "Mapbox Navigation indisponível")))
      return
    }

    mapboxNavigation?.registerRoutesObserver(routesObserver)
    mapboxNavigation?.registerLocationObserver(locationObserver)
    mapboxNavigation?.registerRouteProgressObserver(routeProgressObserver)
    mapboxNavigation?.registerVoiceInstructionsObserver(voiceInstructionsObserver)
    startTripSessionIfPermitted()
    requestRouteIfNeeded()
  }

  private fun detachNavigationView() {
    val nav = mapboxNavigation
    if (nav != null) {
      nav.unregisterRoutesObserver(routesObserver)
      nav.unregisterLocationObserver(locationObserver)
      nav.unregisterRouteProgressObserver(routeProgressObserver)
      nav.unregisterVoiceInstructionsObserver(voiceInstructionsObserver)
      nav.stopTripSession()
      nav.setNavigationRoutes(emptyList())
    }
    hasSetInitialRoute = false
    mapboxNavigation = null
    try {
      MapboxNavigationProvider.destroy()
    } catch (_: Throwable) {
      // Provider pode ter sido destruído por outro ciclo de vida.
    }
    routeLineView?.cancel()
    routeLineApi?.cancel()
    maneuverApi?.cancel()
    speechApi?.cancel()
    voiceInstructionsPlayer?.shutdown()
    routeLineApi = null
    routeLineView = null
    maneuverApi = null
    speechApi = null
    voiceInstructionsPlayer = null
    viewportDataSource = null
    navigationCamera = null
    indicatorPositionListener?.let { l ->
      mapView?.location?.removeOnIndicatorPositionChangedListener(l)
    }
    indicatorPositionListener = null
    maneuverView?.let { removeView(it) }
    maneuverView = null
    mapView?.let { removeView(it) }
    mapView = null
  }

  private fun rebuildRouteIfNeeded() {
    if (mapboxNavigation == null || mapView?.mapboxMap?.style == null) return
    requestRouteIfNeeded()
  }

  private fun applyPendingStyling() {
    updateMute(pendingMute)
    updateCameraMode(pendingCameraMode)
    updateRouteLineColor(pendingRouteLineColor)
    updateHideManeuverBanner(pendingHideManeuverBanner)
    updateHideBottomPanel(pendingHideBottomPanel)
  }

  private fun applyAccessToken() {
    pendingAccessToken?.let { token ->
      MapboxOptions.accessToken = token
      return
    }

    val resId = resources.getIdentifier("mapbox_access_token", "string", context.packageName)
    if (resId == 0) return
    val token = runCatching { resources.getString(resId).trim() }.getOrNull()
    if (!token.isNullOrBlank()) MapboxOptions.accessToken = token
  }

  @SuppressLint("MissingPermission")
  private fun startTripSessionIfPermitted() {
    val fineGranted = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED
    val coarseGranted = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACCESS_COARSE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED
    if (!fineGranted && !coarseGranted) {
      onCancel(mapOf("reason" to "error", "message" to "Permissão de localização ausente"))
      return
    }
    mapboxNavigation?.startTripSession()
  }

  private fun requestRouteIfNeeded() {
    val nav = mapboxNavigation ?: return
    val stopPoints = pendingWaypoints.toValidPoints()
    if (stopPoints.size < 2) return
    val routeRequestPoints = buildGuidedRoutePoints(stopPoints, pendingRouteCoordinates.toValidPoints())
    val points = routeRequestPoints.points
    lastCompletedLegIndex = null
    lastSpokenVoiceKey = null

    val layers = MutableList<Int?>(points.size) { null }
    layers[0] = nav.getZLevel()

    nav.requestRoutes(
      RouteOptions.builder()
        .applyDefaultNavigationOptions()
        .profile(profileFor(pendingProfile))
        .coordinatesList(points)
        .layersList(layers)
        .language(pendingVoiceLanguage)
        .voiceUnits("metric")
        .alternatives(false)
        .apply {
          routeRequestPoints.waypointIndices?.let { waypointIndicesList(it) }
        }
        .build(),
      object : NavigationRouterCallback {
        override fun onCanceled(routeOptions: RouteOptions, routerOrigin: String) {
          onCancel(mapOf("reason" to "session-end"))
        }

        override fun onFailure(reasons: List<RouterFailure>, routeOptions: RouteOptions) {
          onCancel(
            mapOf(
              "reason" to "error",
              "message" to (reasons.firstOrNull()?.message ?: "Falha ao calcular rota"),
            )
          )
        }

        override fun onRoutesReady(routes: List<NavigationRoute>, routerOrigin: String) {
          nav.setNavigationRoutes(routes)
          applyPendingStyling()
          if (pendingCameraMode == "following") navigationCamera?.requestNavigationCameraToFollowing()
        }
      },
    )
  }

  private fun List<Map<String, Any?>>.firstValidPoint(): Point? = toValidPoints().firstOrNull()

  private fun List<Map<String, Any?>>.toValidPoints(): List<Point> =
    mapNotNull { raw ->
      val lat = (raw["latitude"] as? Number)?.toDouble()
      val lng = (raw["longitude"] as? Number)?.toDouble()
      if (lat == null || lng == null) null else Point.fromLngLat(lng, lat)
    }

  private data class RouteRequestPoints(
    val points: List<Point>,
    val waypointIndices: List<Int>?,
  )

  /**
   * O mapa sem SDK já calcula a linha correta (`routeCoordinates`) usando o
   * fluxo legado. Para o SDK não escolher um caminho independente, amostramos
   * essa polyline por trecho, mas sempre preservamos a sequência de paradas
   * reais como waypoints obrigatórios (`waypointIndicesList`).
   */
  private fun buildGuidedRoutePoints(stopPoints: List<Point>, guidePoints: List<Point>): RouteRequestPoints {
    if (guidePoints.size < 2 || stopPoints.size < 2) return RouteRequestPoints(stopPoints, null)
    if (stopPoints.size >= MAX_DIRECTIONS_COORDINATES) return RouteRequestPoints(stopPoints, null)

    val finalPoints = mutableListOf<Point>()
    val waypointIndices = mutableListOf<Int>()
    var remainingSilentSlots = MAX_DIRECTIONS_COORDINATES - stopPoints.size

    fun addPoint(point: Point, forceWaypoint: Boolean) {
      val last = finalPoints.lastOrNull()
      if (last == null || distanceMetersApprox(last, point) > 3.0) {
        finalPoints += point
      } else if (forceWaypoint) {
        finalPoints[finalPoints.lastIndex] = point
      } else {
        return
      }
      if (forceWaypoint && waypointIndices.lastOrNull() != finalPoints.lastIndex) {
        waypointIndices += finalPoints.lastIndex
      }
    }

    addPoint(stopPoints.first(), forceWaypoint = true)

    for (legIndex in 0 until stopPoints.lastIndex) {
      val start = stopPoints[legIndex]
      val end = stopPoints[legIndex + 1]
      val startGuideIndex = nearestGuideIndex(start, guidePoints)
      val endGuideIndex = nearestGuideIndex(end, guidePoints)

      if (remainingSilentSlots > 0 && endGuideIndex > startGuideIndex + 1) {
        val availableGuidePoints = endGuideIndex - startGuideIndex - 1
        val remainingLegs = stopPoints.lastIndex - legIndex
        val maxForThisLeg = ((remainingSilentSlots + remainingLegs - 1) / remainingLegs)
          .coerceAtLeast(1)
        val samplesForLeg = availableGuidePoints.coerceAtMost(maxForThisLeg)

        for (sampleIndex in 1..samplesForLeg) {
          val guideIndex =
            startGuideIndex +
              ((availableGuidePoints + 1).toDouble() * sampleIndex / (samplesForLeg + 1)).toInt()
          if (guideIndex > startGuideIndex && guideIndex < endGuideIndex) {
            addPoint(guidePoints[guideIndex], forceWaypoint = false)
          }
        }
        remainingSilentSlots = (MAX_DIRECTIONS_COORDINATES - stopPoints.size - (finalPoints.size - waypointIndices.size))
          .coerceAtLeast(0)
      }

      addPoint(end, forceWaypoint = true)
    }

    if (finalPoints.size < 2 || waypointIndices.size != stopPoints.size) {
      return RouteRequestPoints(stopPoints, stopPoints.indices.toList())
    }
    return RouteRequestPoints(finalPoints, waypointIndices)
  }

  private fun nearestGuideIndex(point: Point, guidePoints: List<Point>): Int {
    var bestIndex = 0
    var bestDistance = Double.MAX_VALUE
    guidePoints.forEachIndexed { index, candidate ->
      val distance = distanceMetersApprox(point, candidate)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    return bestIndex
  }

  private fun distanceMetersApprox(a: Point, b: Point): Double {
    val earthRadius = 6_371_000.0
    val dLat = Math.toRadians(b.latitude() - a.latitude())
    val dLon = Math.toRadians(b.longitude() - a.longitude())
    val lat1 = Math.toRadians(a.latitude())
    val lat2 = Math.toRadians(b.latitude())
    val h =
      kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
        kotlin.math.cos(lat1) * kotlin.math.cos(lat2) *
        kotlin.math.sin(dLon / 2) * kotlin.math.sin(dLon / 2)
    return 2 * earthRadius * kotlin.math.asin(kotlin.math.min(1.0, kotlin.math.sqrt(h)))
  }

  private fun profileFor(raw: String): String =
    when (raw) {
      "driving" -> "driving"
      "cycling" -> "cycling"
      "walking" -> "walking"
      else -> "driving-traffic"
    }
}
