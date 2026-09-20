import UIKit
import Capacitor
import CoreLocation

/// The app's own view controller, so native code written for Trailcraft can be
/// handed to the web layer as plugins. SceneDelegate makes this the root.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HeadingPlugin())
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
