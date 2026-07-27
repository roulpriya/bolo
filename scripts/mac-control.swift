import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2,
      let data = CommandLine.arguments[1].data(using: .utf8),
      let action = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = action["type"] as? String else {
    fail("Expected one JSON action argument.")
}

func number(_ key: String, default fallback: Double = 0) -> Double {
    (action[key] as? NSNumber)?.doubleValue ?? fallback
}

func point(_ x: Double, _ y: Double) -> CGPoint {
    CGPoint(x: x * number("scaleX", default: 1), y: y * number("scaleY", default: 1))
}

func mouse(_ eventType: CGEventType, at location: CGPoint, button: CGMouseButton = .left, clicks: Int64 = 1) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: eventType, mouseCursorPosition: location, mouseButton: button) else {
        fail("Could not create mouse event.")
    }
    event.setIntegerValueField(.mouseEventClickState, value: clicks)
    event.post(tap: .cghidEventTap)
}

let keyCodes: [String: CGKeyCode] = [
    "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
    "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
    "Y": 16, "T": 17, "O": 31, "U": 32, "I": 34, "P": 35, "L": 37,
    "J": 38, "K": 40, "N": 45, "M": 46,
    "ENTER": 36, "RETURN": 36, "TAB": 48, "SPACE": 49, "BACKSPACE": 51,
    "ESC": 53, "ESCAPE": 53, "COMMAND": 55, "CMD": 55, "META": 55,
    "SHIFT": 56, "CONTROL": 59, "CTRL": 59, "OPTION": 58, "ALT": 58,
    "LEFT": 123, "ARROWLEFT": 123, "RIGHT": 124, "ARROWRIGHT": 124,
    "DOWN": 125, "ARROWDOWN": 125, "UP": 126, "ARROWUP": 126,
    "DELETE": 117, "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121
]

let modifierFlags: [CGKeyCode: CGEventFlags] = [
    55: .maskCommand, 56: .maskShift, 59: .maskControl, 58: .maskAlternate,
]

func flagsFor(_ codes: [CGKeyCode]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for code in codes {
        if let flag = modifierFlags[code] { flags.insert(flag) }
    }
    return flags
}

func keyEvent(_ code: CGKeyCode, down: Bool, flags: CGEventFlags = []) {
    let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
    event?.flags = flags
    event?.post(tap: .cghidEventTap)
}

switch type {
case "permission_status":
    let json = ["accessibilityTrusted": AXIsProcessTrusted()]
    let output = try JSONSerialization.data(withJSONObject: json)
    print(String(data: output, encoding: .utf8)!)
case "screen_size":
    guard let screen = NSScreen.main else { fail("No main screen found.") }
    let json = ["width": screen.frame.width, "height": screen.frame.height]
    let output = try JSONSerialization.data(withJSONObject: json)
    print(String(data: output, encoding: .utf8)!)
case "click", "double_click":
    let location = point(number("x"), number("y"))
    let button: CGMouseButton = (action["button"] as? String) == "right" ? .right : .left
    let down: CGEventType = button == .right ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = button == .right ? .rightMouseUp : .leftMouseUp
    let count: Int64 = type == "double_click" ? 2 : 1
    mouse(down, at: location, button: button, clicks: count)
    mouse(up, at: location, button: button, clicks: count)
    if type == "double_click" {
        usleep(80_000)
        mouse(down, at: location, button: button, clicks: 2)
        mouse(up, at: location, button: button, clicks: 2)
    }
case "move":
    mouse(.mouseMoved, at: point(number("x"), number("y")))
case "scroll":
    let x = Int32(number("scroll_x") / 10)
    let y = Int32(number("scroll_y") / 10)
    CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: y, wheel2: x, wheel3: 0)?.post(tap: .cghidEventTap)
case "type":
    guard let text = action["text"] as? String else { fail("Type action needs text.") }
    let utf16 = Array(text.utf16)
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
        fail("Could not create type event.")
    }
    down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
    up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
case "keypress":
    guard let keys = action["keys"] as? [String], !keys.isEmpty else { fail("Keypress action needs keys.") }
    let codes = keys.compactMap { keyCodes[$0.uppercased()] }
    if codes.count != keys.count { fail("Unsupported key in keypress action.") }
    let flags = flagsFor(codes)
    codes.forEach { keyEvent($0, down: true, flags: flags) }
    codes.reversed().forEach { keyEvent($0, down: false, flags: flags) }
case "drag":
    guard let path = action["path"] as? [[String: Any]], path.count >= 2 else { fail("Drag action needs a path.") }
    let points = path.map { entry in
        point((entry["x"] as? NSNumber)?.doubleValue ?? 0, (entry["y"] as? NSNumber)?.doubleValue ?? 0)
    }
    mouse(.leftMouseDown, at: points[0])
    for entry in points.dropFirst() {
        mouse(.leftMouseDragged, at: entry)
        usleep(20_000)
    }
    mouse(.leftMouseUp, at: points.last!)
default:
    fail("Unsupported action: \(type)")
}
