import ExpoModulesCore
import UIKit
#if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
import Combine
import CoreLocation
import MapboxDirections
import MapboxNavigationCore
import MapboxNavigationUIKit
#endif
#if canImport(MapboxCommon)
import MapboxCommon
#endif

/**
 * View nativa iOS baseada no drop-in `NavigationViewController` do Mapbox
 * Navigation SDK v3. Os overlays React continuam acima desta view no wrapper JS.
 */
public class ExpoMapboxNavigationView: ExpoView {
  let onRouteProgress = EventDispatcher()
  let onReroute = EventDispatcher()
  let onArrival = EventDispatcher()
  let onWaypointArrival = EventDispatcher()
  let onOffRoute = EventDispatcher()
  let onCancel = EventDispatcher()
  let onReady = EventDispatcher()

  private var pendingWaypoints: [[String: Any]] = []
  private var pendingAccessToken: String?
  private var pendingProfile: String = "driving-traffic"
  private var pendingVoiceLanguage: String = "pt-BR"
  private var pendingSimulateRoute: Bool = false
  private var pendingMute: Bool = false
  private var pendingCameraMode: String = "following"
  private var pendingRouteLineColor: String?
  private var pendingHideManeuverBanner: Bool = false
  private var pendingHideBottomPanel: Bool = false
  /** Reservados (pt ≈ dp) quando alinharmos a câmera iOS ao sheet React; Android já aplica na view Kotlin. */
  private var pendingFollowingPaddingTop: Double?
  private var pendingFollowingPaddingBottom: Double?
  private var pendingFollowingPaddingLeft: Double?
  private var pendingFollowingPaddingRight: Double?
  private var pendingFollowingZoom: Double?
  private var pendingRecenterRequestKey: Int?

  #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
  private var navigationProvider: MapboxNavigationProvider?
  private var navigationViewController: NavigationViewController?
  private var cancellables = Set<AnyCancellable>()
  private var routeTask: Task<Void, Never>?
  private var lastCompletedLegIndex: Int?
  private var didEmitOffRoute = false
  #endif

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = UIColor.black
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
      attachNavigationControllerIfNeeded()
      #else
      onCancel([
        "reason": "error",
        "message": "Mapbox Navigation iOS v3 requer SPM; módulo nativo indisponível neste build."
      ])
      #endif
    } else {
      #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
      detachNavigationController()
      #endif
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    navigationViewController?.view.frame = bounds
    #endif
  }

  func updateWaypoints(_ raw: [[String: Any]]) {
    pendingWaypoints = raw
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    rebuildRouteIfNeeded()
    #endif
  }

  func updateAccessToken(_ token: String?) {
    let trimmed = token?.trimmingCharacters(in: .whitespacesAndNewlines)
    pendingAccessToken = trimmed?.isEmpty == false ? trimmed : nil
    #if canImport(MapboxCommon)
    if let pendingAccessToken {
      MapboxOptions.accessToken = pendingAccessToken
    }
    #endif
  }

  func updateProfile(_ profile: String) {
    pendingProfile = profile
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    rebuildRouteIfNeeded()
    #endif
  }

  func updateVoiceLanguage(_ language: String) {
    pendingVoiceLanguage = language
  }

  func updateSimulateRoute(_ simulate: Bool) {
    pendingSimulateRoute = simulate
  }

  func updateMute(_ mute: Bool) {
    pendingMute = mute
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    navigationViewController?.navigationView?.floatingStackView?.volumeButton.isMuted = mute
    #endif
  }

  func updateCameraMode(_ mode: String) {
    pendingCameraMode = mode
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    if mode == "following" {
      navigationViewController?.navigationMapView?.navigationCamera.follow()
    } else if mode == "overview" {
      navigationViewController?.navigationMapView?.navigationCamera.moveToOverview()
    }
    #endif
  }

  func updateRouteLineColor(_ hex: String?) {
    pendingRouteLineColor = hex
  }

  func updateHideManeuverBanner(_ hidden: Bool) {
    pendingHideManeuverBanner = hidden
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    navigationViewController?.navigationView?.topBannerContainerView.isHidden = hidden
    #endif
  }

  func updateHideBottomPanel(_ hidden: Bool) {
    pendingHideBottomPanel = hidden
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    navigationViewController?.navigationView?.bottomBannerContainerView.isHidden = hidden
    #endif
  }

  func updateFollowingPaddingTop(_ value: Double?) {
    pendingFollowingPaddingTop = value
  }

  func updateFollowingPaddingBottom(_ value: Double?) {
    pendingFollowingPaddingBottom = value
  }

  func updateFollowingPaddingLeft(_ value: Double?) {
    pendingFollowingPaddingLeft = value
  }

  func updateFollowingPaddingRight(_ value: Double?) {
    pendingFollowingPaddingRight = value
  }

  func updateFollowingZoom(_ value: Double?) {
    pendingFollowingZoom = value
  }

  func updateRecenterRequestKey(_ value: Int?) {
    guard let value, value != pendingRecenterRequestKey else { return }
    pendingRecenterRequestKey = value
    #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
    navigationViewController?.navigationMapView?.navigationCamera.follow()
    #endif
  }

  #if canImport(MapboxNavigationCore) && canImport(MapboxNavigationUIKit)
  private func attachNavigationControllerIfNeeded() {
    guard navigationViewController == nil else { return }
    requestRoutesAndAttach()
  }

  private func rebuildRouteIfNeeded() {
    guard window != nil else { return }
    requestRoutesAndAttach()
  }

  private func requestRoutesAndAttach() {
    routeTask?.cancel()
    let waypoints = parsedWaypoints()
    guard waypoints.count >= 2 else { return }
    #if canImport(MapboxCommon)
    if let pendingAccessToken {
      MapboxOptions.accessToken = pendingAccessToken
    }
    #endif

    routeTask = Task { [weak self] in
      guard let self else { return }
      do {
        let provider = MapboxNavigationProvider(coreConfig: .init())
        let routeOptions = NavigationRouteOptions(
          waypoints: waypoints,
          profileIdentifier: profileIdentifier(pendingProfile)
        )
        routeOptions.locale = Locale(identifier: pendingVoiceLanguage)

        let routes = try await provider.mapboxNavigation
          .routingProvider()
          .calculateRoutes(options: routeOptions)
          .value

        await MainActor.run {
          self.attach(routes: routes, provider: provider)
        }
      } catch {
        await MainActor.run {
          // Se já existe um NavigationViewController ativo, a sessão de
          // navegação atual continua válida (rota, posição, manobras pré-
          // calculadas funcionam offline). Não disparamos onCancel — o JS
          // caía em `fallbackToLegacyNavigation` e tirava o motorista do
          // SDK no meio da viagem assim que a rede oscilava.
          // Só notificamos quando ainda não há controller (primeira tentativa
          // falhou) — aí o fallback é o caminho correto.
          if self.navigationViewController != nil {
            return
          }
          self.onCancel(["reason": "error", "message": "\(error)"])
        }
      }
    }
  }

  @MainActor
  private func attach(routes: NavigationRoutes, provider: MapboxNavigationProvider) {
    detachNavigationController()
    navigationProvider = provider

    let navigationOptions = NavigationOptions(
      mapboxNavigation: provider.mapboxNavigation,
      voiceController: provider.routeVoiceController,
      eventsManager: provider.eventsManager()
    )
    let controller = NavigationViewController(
      navigationRoutes: routes,
      navigationOptions: navigationOptions
    )

    if let parent = parentViewController() {
      parent.addChild(controller)
      controller.view.frame = bounds
      controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(controller.view)
      controller.didMove(toParent: parent)
    } else {
      controller.view.frame = bounds
      controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(controller.view)
    }

    navigationViewController = controller
    subscribeToProgress(provider: provider)
    applyPendingStyling()
    onReady([:])
  }

  private func detachNavigationController() {
    routeTask?.cancel()
    routeTask = nil
    cancellables.removeAll()
    if let controller = navigationViewController {
      controller.willMove(toParent: nil)
      controller.view.removeFromSuperview()
      controller.removeFromParent()
    }
    navigationViewController = nil
    navigationProvider = nil
    lastCompletedLegIndex = nil
    didEmitOffRoute = false
  }

  private func subscribeToProgress(provider: MapboxNavigationProvider) {
    provider.mapboxNavigation
      .navigation()
      .routeProgress
      .receive(on: DispatchQueue.main)
      .sink { [weak self] progress in
        guard let self, let progress else { return }
        self.emit(progress: progress)
      }
      .store(in: &cancellables)
  }

  private func emit(progress: RouteProgress) {
    let legIndex = progress.currentLegProgress.legIndex
    if progress.routeProgressState == .complete && lastCompletedLegIndex != legIndex {
      lastCompletedLegIndex = legIndex
      let isFinal = legIndex >= max(pendingWaypoints.count - 2, 0)
      let payload: [String: Any] = [
        "waypointIndex": legIndex + 1,
        "isFinalDestination": isFinal
      ]
      if isFinal {
        onArrival(payload)
      } else {
        onWaypointArrival(payload)
      }
    }

    if progress.routeProgressState == .offRoute || progress.routeProgressState == .uncertain {
      if !didEmitOffRoute {
        didEmitOffRoute = true
        onOffRoute(["distanceMeters": 0])
        onReroute(["reason": "off-route"])
      }
    } else {
      didEmitOffRoute = false
    }

    let stepProgress = progress.currentLegProgress.currentStepProgress
    onRouteProgress([
      "distanceRemainingMeters": progress.distanceRemaining,
      "durationRemainingSeconds": progress.durationRemaining,
      "distanceTraveledMeters": progress.distanceTraveled,
      "fractionTraveled": progress.fractionTraveled,
      "upcomingManeuverText": stepProgress.currentStep.instructions,
      "upcomingManeuverType": stepProgress.currentStep.maneuverType?.rawValue as Any,
      "upcomingManeuverDistanceMeters": stepProgress.distanceRemaining
    ])
  }

  private func parsedWaypoints() -> [Waypoint] {
    pendingWaypoints.compactMap { dict in
      guard let lat = dict["latitude"] as? Double,
            let lng = dict["longitude"] as? Double else { return nil }
      let waypoint = Waypoint(
        coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
        name: dict["name"] as? String
      )
      waypoint.separatesLegs = !(dict["isSilent"] as? Bool ?? false)
      return waypoint
    }
  }

  private func profileIdentifier(_ raw: String) -> ProfileIdentifier {
    switch raw {
    case "driving": return .automobile
    case "cycling": return .cycling
    case "walking": return .walking
    default: return .automobileAvoidingTraffic
    }
  }

  private func parentViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let vc = current as? UIViewController { return vc }
      responder = current.next
    }
    return nil
  }

  private func applyPendingStyling() {
    updateMute(pendingMute)
    updateCameraMode(pendingCameraMode)
    updateRouteLineColor(pendingRouteLineColor)
    updateHideManeuverBanner(pendingHideManeuverBanner)
    updateHideBottomPanel(pendingHideBottomPanel)
  }
  #endif
}
