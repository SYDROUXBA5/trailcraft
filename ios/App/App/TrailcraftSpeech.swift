import Foundation
import AVFoundation
import Capacitor

/// The coach's voice, spoken by iOS itself rather than by the web view.
///
/// The web view's speech (WebKit's speechSynthesis) only ever lists the voices
/// the phone came with, never the Premium and Enhanced ones a handler downloads
/// in Settings, so the coach sounded like a machine however good a voice the
/// phone held. And it cannot be heard once the screen goes dark, which is where
/// a phone on a trail spends its time: in a pocket. Here both are put right.
/// Every voice on the phone is listed, downloaded ones included, and a call is
/// spoken through an audio session that plays with the screen locked (the app
/// is already running then, recording in the background; "audio" in
/// Info.plist's background modes is what lets it be heard as well). The
/// handler's music dips under the call and comes back when it ends.
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "SpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    /// Only ever touched on the main queue, like the rest of this plugin's state.
    private var synth = AVSpeechSynthesizer()
    /// Counts the calls handed to iOS. The audio session is let go only when no
    /// call has come since the last one ended, so a call that cuts off the one
    /// before it is never left talking into a session that has just closed.
    private var said = 0

    override public func load() {
        synth.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(interruption(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
        /* A voice downloaded while the app is open turns up without a relaunch
           (iOS 17 and later; before that, the list is read again whenever the
           app comes back to the front). */
        if #available(iOS 17.0, *) {
            NotificationCenter.default.addObserver(self, selector: #selector(voicesChanged),
                                                   name: AVSpeechSynthesizer.availableVoicesDidChangeNotification, object: nil)
        }
    }

    @objc private func voicesChanged() {
        notifyListeners("voicesChanged", data: [:])
    }

    /* A phone call or Siri takes the sound from under a call being spoken
       (iOS has already let go of the session for us). The call is cut off
       rather than left to finish into nothing. The next call asks for the
       session again (takeAudio), and whether iOS gives it back is what that
       call reports as heard, so once the interruption is over nothing is
       left to put right here. */
    @objc private func interruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async {
            self.synth.stopSpeaking(at: .immediate)
        }
    }

    /// Every voice on the phone, with how good iOS says it is. The web side
    /// ranks them; nothing is left out here, so the ranking stays in one place.
    @objc func voices(_ call: CAPPluginCall) {
        let list = AVSpeechSynthesisVoice.speechVoices().map { v -> [String: Any] in
            var novelty = false
            if #available(iOS 17.0, *) { novelty = v.voiceTraits.contains(.isNoveltyVoice) }
            return [
                "identifier": v.identifier,
                "name": v.name,
                "language": v.language,
                "quality": SpeechPlugin.qualityName(v.quality),
                "novelty": novelty
            ]
        }
        call.resolve(["voices": list])
    }

    static func qualityName(_ quality: AVSpeechSynthesisVoiceQuality) -> String {
        if #available(iOS 16.0, *), quality == .premium { return "premium" }
        return quality == .enhanced ? "enhanced" : "default"
    }

    /// Say one call now. It cuts off whatever was still being said, as the
    /// coach on the web does: the newest call is the one that is true.
    /// Resolves with `heard`: false when iOS would not give the app the sound
    /// (a phone call, Siri), so the coach counts the call as missed and says
    /// so, rather than going quiet as if the dog were on the line. Not a
    /// rejection, which would hand the coach to the web view for good.
    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("Nothing to say")
            return
        }
        let voiceId = call.getString("voice")
        let lang = call.getString("lang") ?? "en-GB"
        let rate = call.getFloat("rate") ?? 1
        DispatchQueue.main.async {
            let utterance = AVSpeechUtterance(string: text)
            /* The chosen voice while the phone still has it; else the English
               asked for; else British English, never the phone's own language
               (an iPhone set to French would read "Off the trail" in French). */
            utterance.voice = voiceId.flatMap { AVSpeechSynthesisVoice(identifier: $0) }
                ?? AVSpeechSynthesisVoice(language: lang)
                ?? AVSpeechSynthesisVoice(language: "en-GB")
            utterance.rate = SpeechPlugin.platformRate(rate)
            if self.synth.isSpeaking { self.synth.stopSpeaking(at: .immediate) }
            let heard = self.takeAudio()
            self.said += 1
            self.synth.speak(utterance)
            call.resolve(["heard": heard])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synth.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    /// The web's pace (1 is normal) in iOS's own terms, by the same sum WebKit
    /// uses, so a voice keeps the pace it had when the web view spoke it.
    static func platformRate(_ rate: Float) -> Float {
        let normal = AVSpeechUtteranceDefaultSpeechRate
        let r = rate < 1 ? rate * normal
            : normal + (rate - 1) * (AVSpeechUtteranceMaximumSpeechRate - normal)
        return min(max(r, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
    }

    /* Playback, so the call is heard with the screen locked and with the ring
       switch on silent. Ducking others, so the handler's music or podcast dips
       under it (spoken audio pauses) rather than stopping for good. Both
       options leave the session mixable, and a mixable session is one iOS lets
       an app start from the background. Voice prompt is Apple's mode for
       short spoken prompts like a satnav's. False when iOS refused it. */
    private func takeAudio() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .voicePrompt,
                                    options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try session.setActive(true)
            return true
        } catch {
            CAPLog.print("Speech: could not take the audio session: \(error)")
            return false
        }
    }

    /* Let go once the last call has ended, and tell the others, so the music
       comes back up. A breath of delay: a call made in that moment keeps the
       session rather than having it closed under it. The web view's own tones
       may hold the session still, and then letting go fails harmlessly. */
    private func ended() {
        DispatchQueue.main.async {
            let now = self.said
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                guard self.said == now, !self.synth.isSpeaking else { return }
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        ended()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        ended()
    }
}
