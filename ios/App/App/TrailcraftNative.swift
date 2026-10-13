import UIKit
import Capacitor
import CoreLocation

/// The app's own view controller, so native code written for Trailcraft can be
/// handed to the web layer as plugins. SceneDelegate makes this the root.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeadingPlugin())
        bridge?.registerPluginInstance(SpeechPlugin())      // TrailcraftSpeech.swift: the coach's voice
        bridge?.registerPluginInstance(KeepAwakePlugin())   // the screen held on while a replay is recorded as a video
    }
}

/// The phone's compass, straight from Core Location.
///
/// The web layer can only reach the compass through a browser permission that
/// must be asked for inside a tap, is forgotten at every launch, and is easy to
/// refuse by accident — a compass that sits still until someone knows to tap it
/// is a compass that "does not work". Core Location needs none of that: the app
/// already has location access, and the heading arrives as true north.
@objc(HeadingPlugin)
public class HeadingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "HeadingPlugin"
    public let jsName = "Heading"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard CLLocationManager.headingAvailable() else {
                call.reject("This device has no compass")
                return
            }
            if self.manager == nil {
                let m = CLLocationManager()
                m.delegate = self
                m.headingFilter = 1          // degrees of turn before the next report
                self.manager = m
            }
            self.manager?.startUpdatingHeading()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager?.stopUpdatingHeading()
            call.resolve()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }      // negative means the reading is not valid
        // True north needs a position; until there is one, magnetic is the honest answer.
        let isTrue = newHeading.trueHeading >= 0
        notifyListeners("heading", data: [
            "heading": isTrue ? newHeading.trueHeading : newHeading.magneticHeading,
            "accuracy": newHeading.headingAccuracy,
            "isTrue": isTrue
        ])
    }

    /// Let iOS show its figure-of-eight calibration card when the compass needs it.
    public func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        return true
    }
}

/// The screen kept on while the replay is being recorded as a video.
///
/// Nobody touches the phone for the half-minute or minute that takes, so iOS
/// dims and locks it (after 30 seconds unless the owner chose otherwise), the
/// app goes to the background and the recording is lost. A web page can ask
/// for the screen to stay on, but not on iOS before 16.4, and inside an app's
/// web view the request has not always been honoured. The idle timer is the
/// system's own switch for it and works on every iOS this app runs on.
/// `off` always follows `on`: the web layer calls it whichever way a recording
/// ends, and iOS drops the setting itself when the app leaves the screen.
@objc(KeepAwakePlugin)
public class KeepAwakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KeepAwakePlugin"
    public let jsName = "KeepAwake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "on", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "off", returnType: CAPPluginReturnPromise)
    ]

    @objc func on(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
            call.resolve()
        }
    }

    @objc func off(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
            call.resolve()
        }
    }
}
