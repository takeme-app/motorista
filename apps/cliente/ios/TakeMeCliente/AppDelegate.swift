import Expo
import FirebaseCore
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Sem isto não existe FirebaseApp padrão no iOS e o @react-native-firebase/messaging
    // nunca devolve token — o registro em clienteFcm/motoristaFcm desiste em silêncio e o
    // aparelho jamais recebe push. No Android o plugin Gradle do google-services inicializa
    // sozinho via ContentProvider, e foi por isso que só o iOS ficou sem token nenhum.
    // O config plugin do @react-native-firebase/app injetaria esta chamada no prebuild, mas
    // o projeto é bare com ios/ versionado: aqui ela precisa estar no arquivo.
    if FirebaseApp.app() == nil {
      FirebaseApp.configure()
    }

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    let bundleRoot = ".expo/.virtual-metro-entry"
    let settings = RCTBundleURLProvider.sharedSettings()
    // Default path asks Metro for /status first; that check sometimes fails in the simulator
    // (proxy, IPv6/localhost, timing) and returns nil → "No script URL provided".
    if let url = settings.jsBundleURL(forBundleRoot: bundleRoot) {
      return url
    }
#if targetEnvironment(simulator)
    return RCTBundleURLProvider.jsBundleURL(
      forBundleRoot: bundleRoot,
      packagerHost: "127.0.0.1:8081",
      enableDev: true,
      enableMinification: false,
      inlineSourceMap: false
    )
#else
    return nil
#endif
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
