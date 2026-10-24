import Foundation
import Vision

// 只识别已经保存的原始PNG；不访问应用，不修改或生成截图。
// https://developer.apple.com/documentation/vision/recognizing-text-in-images
for file in CommandLine.arguments.dropFirst() {
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US", "zh-Hans", "zh-Hant"]
    try VNImageRequestHandler(url: URL(fileURLWithPath: file), options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> [String: Any]? in
        guard let text = observation.topCandidates(1).first else { return nil }
        let bounds = observation.boundingBox
        return ["text": text.string, "confidence": text.confidence,
            "bounds": ["x": bounds.minX, "y": 1 - bounds.maxY,
                "width": bounds.width, "height": bounds.height]]
    }
    let data = try JSONSerialization.data(withJSONObject: lines, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
