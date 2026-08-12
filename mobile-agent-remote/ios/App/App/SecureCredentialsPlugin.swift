import Capacitor
import Foundation
import Security

@objc(SecureCredentialsPlugin)
public class SecureCredentialsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureCredentialsPlugin"
    public let jsName = "SecureCredentials"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.remoteagent.mobile.gateway-credentials"

    @objc func get(_ call: CAPPluginCall) {
        guard let key = validatedKey(call) else { return }
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Unable to read secure credential", "KEYCHAIN_READ_FAILED")
            return
        }
        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = validatedKey(call), let value = call.getString("value") else {
            if call.getString("value") == nil { call.reject("value is required", "INVALID_VALUE") }
            return
        }
        let maxBytes = key == "remote-agent.gateway.connections.v1" ? 32768 : 4096
        guard let data = value.data(using: .utf8), data.count <= maxBytes else {
            call.reject("value is too large", "INVALID_VALUE")
            return
        }

        let query = baseQuery(key)
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject("Unable to store secure credential", "KEYCHAIN_WRITE_FAILED")
            return
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = validatedKey(call) else { return }
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Unable to remove secure credential", "KEYCHAIN_DELETE_FAILED")
            return
        }
        call.resolve()
    }

    private func validatedKey(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"),
              key == "remote-agent.gateway.url" ||
              key == "remote-agent.gateway.token" ||
              key == "remote-agent.gateway.connections.v1" else {
            call.reject("Unsupported credential key", "INVALID_KEY")
            return nil
        }
        return key
    }

    private func baseQuery(_ key: String) -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }
}
