import Darwin
import Foundation
import Security

struct GarminConnection: Codable {
    let id: UUID
    let key: String
}

struct Keychain {
    let service: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "Garmin Personal API"]
    }

    func read() throws -> GarminConnection? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let connection = try? JSONDecoder().decode(GarminConnection.self, from: data) else {
            throw GroundTruthError.keychainUnavailable
        }
        return connection
    }

    func write(_ connection: GarminConnection) throws {
        let data = try JSONEncoder().encode(connection)
        var request = query
        // The login Keychain's default access list trusts the creating app and
        // requests user approval for other apps. Its default is non-synchronizing.
        request[kSecValueData as String] = data
        var status = SecItemAdd(request as CFDictionary, nil)
        if status == errSecDuplicateItem {
            status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        }
        guard status == errSecSuccess else { throw GroundTruthError.keychainUnavailable }
    }

    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw GroundTruthError.keychainUnavailable
        }
    }
}

struct SavedDashboard: Codable {
    let connectionID: UUID
    let syncedAt: Date
    let data: Dashboard
}

struct SnapshotStore {
    let directory: URL

    private var snapshot: URL { directory.appendingPathComponent("garmin-snapshot.json") }

    func read(connectionID: UUID) -> SavedDashboard? {
        guard let bytes = try? Data(contentsOf: snapshot, options: [.mappedIfSafe]) else { return nil }
        guard let value = try? JSONDecoder().decode(SavedDashboard.self, from: bytes),
              value.connectionID == connectionID else { return nil }
        return value
    }

    func write(_ value: SavedDashboard) throws {
        do {
            let files = FileManager.default
            try files.createDirectory(at: directory, withIntermediateDirectories: true,
                                      attributes: [.posixPermissions: 0o700])
            try files.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            var privateDirectory = directory
            var metadata = URLResourceValues()
            metadata.isExcludedFromBackup = true
            try privateDirectory.setResourceValues(metadata)
            let staging = directory.appendingPathComponent(".snapshot-\(UUID().uuidString)")
            defer { try? files.removeItem(at: staging) }
            let data = try JSONEncoder().encode(value)
            guard files.createFile(atPath: staging.path, contents: data, attributes: [.posixPermissions: 0o600]),
                  rename(staging.path, snapshot.path) == 0 else {
                throw GroundTruthError.localStorageUnavailable
            }
        } catch { throw GroundTruthError.localStorageUnavailable }
    }

    func remove() throws {
        do { try FileManager.default.removeItem(at: snapshot) }
        catch let error as CocoaError where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile { return }
        catch { throw GroundTruthError.localStorageUnavailable }
    }
}
