import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ScreenCaptureKit

struct ControlError: Error { let message: String }
func fail(_ message: String) throws -> Never { throw ControlError(message: message) }
func output(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
}
let keyCodes: [String: CGKeyCode] = [
    "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
    "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
    "Y": 16, "T": 17, "O": 31, "U": 32, "I": 34, "P": 35, "L": 37,
    "J": 38, "K": 40, "N": 45, "M": 46, "1": 18, "2": 19, "3": 20,
    "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "=": 24, "-": 27, "]": 30, "[": 33, "'": 39, ";": 41, "\\": 42,
    ",": 43, "/": 44, ".": 47, "`": 50,
    "ENTER": 36, "TAB": 48, "SPACE": 49, "BACKSPACE": 51, "ESCAPE": 53,
    "META": 55, "SHIFT": 56, "CONTROL": 59, "ALT": 58,
    "ARROWLEFT": 123, "ARROWRIGHT": 124, "ARROWDOWN": 125, "ARROWUP": 126,
    "DELETE": 117, "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121,
    "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
    "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111
]

@main struct DesktopControl {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 2,
                  let data = CommandLine.arguments[1].data(using: .utf8),
                  let action = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = action["type"] as? String else { try fail("Expected one JSON desktop action.") }
            try await run(type, action)
        } catch {
            let message = (error as? ControlError)?.message ?? "Desktop control failed. Check macOS Accessibility and Screen Recording permissions."
            FileHandle.standardError.write(Data((message + "\n").utf8))
            exit(1)
        }
    }

    static func run(_ type: String, _ action: [String: Any]) async throws {
        func number(_ key: String) -> Double { (action[key] as? NSNumber)?.doubleValue ?? 0 }
        if type == "permissions" {
            try output(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]); return
        }
        guard AXIsProcessTrusted() else { try fail("Enable Accessibility for Bolo Desktop Control.app in macOS System Settings, then retry.") }
        let displayId = CGMainDisplayID()
        let bounds = CGDisplayBounds(displayId)
        if type == "screenshot" || type == "zoom" {
            guard CGPreflightScreenCaptureAccess() else { try fail("Enable Screen Recording for Bolo Desktop Control.app in macOS System Settings, then retry.") }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first(where: { $0.displayID == displayId }) else { try fail("Main display is unavailable.") }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            let scale = min(1.0, 1280.0 / Double(display.width), 800.0 / Double(display.height))
            config.width = max(1, Int(Double(display.width) * scale))
            config.height = max(1, Int(Double(display.height) * scale))
            config.showsCursor = true
            if type == "zoom" {
                try validateDisplay(action, bounds, displayId)
                guard let region = action["region"] as? [Double], region.count == 4 else { try fail("Invalid zoom region.") }
                let sx = bounds.width / number("width"), sy = bounds.height / number("height")
                let rect = CGRect(x: region[0] * sx, y: region[1] * sy, width: (region[2] - region[0]) * sx, height: (region[3] - region[1]) * sy)
                guard rect.width > 0, rect.height > 0, CGRect(origin: .zero, size: bounds.size).contains(rect) else { try fail("Zoom is outside the display.") }
                config.sourceRect = rect
                let zoomScale = min(2.0, 1280.0 / rect.width, 800.0 / rect.height)
                config.width = max(1, Int(rect.width * zoomScale)); config.height = max(1, Int(rect.height * zoomScale))
            }
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { try fail("Could not encode screenshot.") }
            try output(["image": png.base64EncodedString(), "width": image.width, "height": image.height,
                        "displayId": displayId, "displayWidth": bounds.width, "displayHeight": bounds.height]); return
        }
        // Releases must remain possible after a display change or task cancellation.
        if type != "key_up" && type != "mouse_up" { try validateDisplay(action, bounds, displayId) }
        let keyNames = action["keys"] as? [String] ?? []
        var flags: CGEventFlags = []
        for key in keyNames {
            switch key.uppercased() { case "META": flags.insert(.maskCommand); case "SHIFT": flags.insert(.maskShift); case "ALT": flags.insert(.maskAlternate); case "CONTROL": flags.insert(.maskControl); default: break }
        }
        let cursor = CGEvent(source: nil)?.location ?? .zero
        func mouse(_ eventType: CGEventType, _ at: CGPoint, _ button: CGMouseButton = .left, _ count: Int64 = 1) throws {
            guard let event = CGEvent(mouseEventSource: nil, mouseType: eventType, mouseCursorPosition: at, mouseButton: button) else { try fail("Could not create mouse event.") }
            event.flags = flags; event.setIntegerValueField(.mouseEventClickState, value: count); event.post(tap: .cghidEventTap)
        }
        switch type {
        case "move":
            let x = number("x"), y = number("y")
            guard x >= 0, y >= 0, x < number("width"), y < number("height") else { try fail("Pointer is outside the screenshot.") }
            let location = CGPoint(x: bounds.origin.x + x * bounds.width / number("width"), y: bounds.origin.y + y * bounds.height / number("height"))
            try mouse(action["dragging"] as? Bool == true ? .leftMouseDragged : .mouseMoved, location)
        case "mouse_down": try mouse(.leftMouseDown, cursor)
        case "mouse_up": try mouse(.leftMouseUp, cursor)
        case "click":
            let name = action["button"] as? String ?? "left"
            let button: CGMouseButton = name == "right" ? .right : (["middle", "wheel"].contains(name) ? .center : .left)
            let down: CGEventType = button == .right ? .rightMouseDown : (button == .center ? .otherMouseDown : .leftMouseDown)
            let up: CGEventType = button == .right ? .rightMouseUp : (button == .center ? .otherMouseUp : .leftMouseUp)
            let count = Int(number("count")); guard (1...3).contains(count) else { try fail("Invalid click count.") }
            for index in 1...count { try mouse(down, cursor, button, Int64(index)); try mouse(up, cursor, button, Int64(index)); if index < count { usleep(70_000) } }
        case "scroll":
            guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: -Int32(number("scroll_y")), wheel2: -Int32(number("scroll_x")), wheel3: 0) else { try fail("Could not create scroll event.") }
            event.flags = flags; event.post(tap: .cghidEventTap)
        case "key_down", "key_up":
            guard let key = action["key"] as? String, let code = keyCodes[key.uppercased()], let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: type == "key_down") else { try fail("Unsupported desktop key.") }
            event.flags = flags; event.post(tap: .cghidEventTap)
        case "type":
            guard let text = action["text"] as? String else { try fail("Type requires text.") }
            // A composed character stays intact across event chunks, including emoji and Indic text.
            for character in text {
                let units = Array(String(character).utf16)
                guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true), let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { try fail("Could not create text event.") }
                down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
                usleep(100)
            }
        case "cursor_position":
            try output(["x": Int((cursor.x - bounds.origin.x) * number("width") / bounds.width), "y": Int((cursor.y - bounds.origin.y) * number("height") / bounds.height)])
        default: try fail("Unsupported desktop action.")
        }
    }

    static func validateDisplay(_ action: [String: Any], _ bounds: CGRect, _ id: CGDirectDisplayID) throws {
        guard (action["displayId"] as? NSNumber)?.uint32Value == id,
              (action["displayWidth"] as? NSNumber)?.doubleValue == bounds.width,
              (action["displayHeight"] as? NSNumber)?.doubleValue == bounds.height,
              let width = action["width"] as? Double, width > 0,
              let height = action["height"] as? Double, height > 0 else { try fail("Display changed. Take a fresh screenshot before acting.") }
    }
}
