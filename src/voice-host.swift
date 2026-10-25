// Interpreted by Apple's swift-frontend. Swift 5.5 / macOS Monterey APIs only.
// Same JSON protocol as voice-host.js; no shell evaluation of speech text.
import Foundation
import AVFoundation

enum HostError: Error, CustomStringConvertible {
    case message(String)
    var description: String {
        switch self { case .message(let text): return text }
    }
}

struct SpeechRequest: Decodable {
    let id: String
    let text: String
    let factor: Double
    let pitch: Double?
    let output: String?
}

struct HostControl: Decodable {
    let command: String
    let time: Double
}

final class SpeechSession: NSObject, AVSpeechSynthesizerDelegate {
    let directory: URL
    let synthesizer = AVSpeechSynthesizer()
    var started = false
    var finished = false
    var cancelled = false
    var lastState = ""
    var wordRange: NSRange?
    var reportedRange: NSRange?

    // AVFoundation's audio callback can run off the main thread. Keep buffer
    // writes and completion under one lock; Cocoa/UI stays in the parent.
    let audioLock = NSLock()
    var audioFile: AVAudioFile?
    var audioEnded = false
    var audioError: Error?
    var audioFrames: AVAudioFramePosition = 0
    var lastBufferAt = Date()
    var exporting = false

    init(directory: URL) {
        self.directory = directory
        super.init()
        synthesizer.delegate = self
    }

    func report(_ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        try data.write(to: directory.appendingPathComponent("result.json"), options: .atomic)
    }

    func read<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        let data = try Data(contentsOf: directory.appendingPathComponent(name + ".json"))
        return try JSONDecoder().decode(type, from: data)
    }

    func listVoices() throws {
        let voices = AVSpeechSynthesisVoice.speechVoices().map {
            ["id": $0.identifier, "name": $0.name, "locale": $0.language]
        }
        try report(["state": "voices", "voices": voices])
    }

    func speak(export: Bool = false) throws {
        defer {
            synthesizer.delegate = nil
            synthesizer.stopSpeaking(at: .immediate)
            audioLock.lock()
            audioEnded = true
            audioFile = nil
            audioLock.unlock()
        }
        let request = try read("request", as: SpeechRequest.self)
        guard !request.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw HostError.message("Нет текста для чтения.")
        }
        guard let voice = AVSpeechSynthesisVoice(identifier: request.id) else {
            throw HostError.message("Swift не получил выбранный голос. Обновите список.")
        }
        let utterance = AVSpeechUtterance(string: request.text)
        utterance.voice = voice
        if let pitch = request.pitch, pitch.isFinite, pitch != 1 {
            utterance.pitchMultiplier = Float(min(2, max(0.5, pitch)))
        }
        let factor = request.factor.isFinite ? min(2, max(0.5, request.factor)) : 1
        utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate,
            max(AVSpeechUtteranceMinimumSpeechRate, utterance.rate * Float(factor)))
        let deadline = Date().addingTimeInterval(15)
        try checkLease()
        if export {
            guard let output = request.output, output.hasPrefix("/") else {
                throw HostError.message("Не указан путь аудиофайла.")
            }
            exporting = true
            try writeAudio(utterance, to: URL(fileURLWithPath: output))
            return
        }
        synthesizer.speak(utterance)
        while !finished {
            let control = try checkLease()
            if started && control.command == "pause" && !synthesizer.isPaused {
                synthesizer.pauseSpeaking(at: .immediate)
            } else if control.command == "play" && synthesizer.isPaused {
                synthesizer.continueSpeaking()
            }
            if started {
                let state = synthesizer.isPaused ? "paused" : "speaking"
                if state != lastState || wordRange != reportedRange {
                    var value: [String: Any] = ["state": state]
                    if let range = wordRange {
                        value["range"] = ["location": range.location, "length": range.length]
                    }
                    try report(value)
                    lastState = state
                    reportedRange = wordRange
                }
            } else if Date() > deadline {
                throw HostError.message("Голос не начал чтение за 15 секунд.")
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        if cancelled { throw HostError.message("Система прервала чтение.") }
        try report(["state": "finished"])
    }

    func writeAudio(_ utterance: AVSpeechUtterance, to url: URL) throws {
        try report(["state": "exporting"])
        lastBufferAt = Date()
        synthesizer.write(utterance) { [self] buffer in
            audioLock.lock()
            defer { audioLock.unlock() }
            if audioEnded || audioError != nil { return }
            guard let pcm = buffer as? AVAudioPCMBuffer else {
                audioError = HostError.message("Голос вернул неизвестный формат аудио.")
                return
            }
            lastBufferAt = Date()
            if pcm.frameLength == 0 {
                audioFile = nil // Close the CAF header before reporting success.
                audioEnded = true
                return
            }
            do {
                if audioFile == nil {
                    audioFile = try AVAudioFile(forWriting: url, settings: pcm.format.settings,
                        commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
                }
                try audioFile!.write(from: pcm)
                audioFrames += AVAudioFramePosition(pcm.frameLength)
            } catch { audioError = error }
        }
        while true {
            try checkLease()
            audioLock.lock()
            let ended = audioEnded, error = audioError, frames = audioFrames
            let stalled = Date().timeIntervalSince(lastBufferAt) > 60
            audioLock.unlock()
            if let error = error { throw error }
            if cancelled { throw HostError.message("Система прервала сохранение.") }
            if ended {
                guard frames > 0 else { throw HostError.message("Голос не создал аудиоданные.") }
                break
            }
            if stalled { throw HostError.message("Нет аудиоданных от голоса более 60 секунд.") }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        try report(["state": "finished"])
    }

    @discardableResult
    func checkLease() throws -> HostControl {
        let control = try read("control", as: HostControl.self)
        guard control.time.isFinite, Date().timeIntervalSince1970 * 1000 - control.time <= 15000 else {
            throw HostError.message("Приложение больше не отвечает.")
        }
        return control
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        started = true
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
                          willSpeakRangeOfSpeechString characterRange: NSRange,
                          utterance: AVSpeechUtterance) {
        if !exporting { wordRange = characterRange }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finished = true
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        cancelled = true
        finished = true
    }
}

guard CommandLine.arguments.count == 3 else { exit(2) }
let mode = CommandLine.arguments[1]
guard mode == "list" || mode == "speak" || mode == "export" else { exit(2) }
let session = SpeechSession(directory: URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true))
do {
    if mode == "list" { try session.listVoices() }
    else { try session.speak(export: mode == "export") }
} catch {
    try? session.report(["state": "error", "message": String(describing: error)])
    exit(1)
}
