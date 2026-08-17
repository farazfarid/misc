import AVFoundation
import AppKit

/// Synthesizes a two-tone wailing siren in code so the app ships with no bundled
/// audio asset, and forces system output volume to maximum before playing.
final class SirenPlayer {
    private let engine = AVAudioEngine()
    private var sourceNode: AVAudioSourceNode?
    private var sampleCounter: Double = 0
    private var frequency: Double = 900
    private var toggleTimer: Timer?
    private(set) var isPlaying = false

    func start() {
        guard !isPlaying else { return }
        isPlaying = true
        forceMaxVolume()

        let format = engine.outputNode.inputFormat(forBus: 0)
        let sampleRate = format.sampleRate

        let node = AVAudioSourceNode { [weak self] _, _, frameCount, audioBufferList in
            guard let self else { return noErr }
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            for frame in 0..<Int(frameCount) {
                let value = Float(sin(2.0 * Double.pi * self.frequency * self.sampleCounter / sampleRate)) * 0.9
                self.sampleCounter += 1
                for buffer in ablPointer {
                    let buf = UnsafeMutableBufferPointer<Float>(buffer)
                    buf[frame] = value
                }
            }
            return noErr
        }

        sourceNode = node
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 1.0

        toggleTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.frequency = self.frequency == 900 ? 1400 : 900
        }

        do {
            try engine.start()
        } catch {
            NSSound.beep()
        }
    }

    func stop() {
        guard isPlaying else { return }
        isPlaying = false
        toggleTimer?.invalidate()
        toggleTimer = nil
        engine.stop()
        if let node = sourceNode {
            engine.detach(node)
        }
        sourceNode = nil
    }

    private func forceMaxVolume() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", "set volume output volume 100"]
        try? task.run()
    }
}
