import XCTest

final class RemoteAgentUITests: XCTestCase {
    private var app: XCUIApplication!
    private var pairingCode = ""

    private var webView: XCUIElement {
        app.webViews.firstMatch
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchEnvironment["REMOTE_AGENT_UI_TEST_RESET_SECURE_STORE"] = "1"
        app.launch()
    }

    // [PAIR-002] [SESSION-002] Disconnected native startup exposes no fixture sessions
    // and keeps exactly one primary pairing entry.
    func testDisconnectedHomeHasOneConnectionEntry() throws {
        XCTAssertTrue(webView.waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["查看 Mac 连接状态"].exists)
        XCTAssertTrue(app.staticTexts["连接 Mac 后查看真实会话"].exists)
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "label == %@", "连接 Mac")).count,
            1
        )
        app.buttons["查看 Mac 连接状态"].tap()
        XCTAssertTrue(app.staticTexts["Mac 网关地址"].waitForExistence(timeout: 4))
        closeVisibleSheet()
        keepScreenshot(named: "01-disconnected-home")
    }

    // [PAIR-002] [DEVICE-002] [DEVICE-004] [SESSION-002] [SESSION-003]
    // [SESSION-004] [SESSION-005] [SESSION-008] [FILE-001] [MOBILE-002]
    func testCompleteNativeGatewayFlow() throws {
        pairingCode = try fetchPairingCode(port: 17831)
        XCTAssertTrue(pairingCode.range(of: #"^\d{6}$"#, options: .regularExpression) != nil)
        try setGatewayDelay(0, port: 17831)
        try setGatewayDelay(0, port: 17832)
        addTeardownBlock { [weak self] in
            try? self?.setGatewayDelay(0, port: 17831)
            try? self?.setGatewayDelay(0, port: 17832)
        }

        XCTAssertTrue(app.staticTexts["连接 Mac 后查看真实会话"].waitForExistence(timeout: 8))
        app.buttons["连接 Mac"].tap()
        try pairVisibleGateway(port: 17831, verifyRejectedCode: false)
        XCTAssertTrue(app.staticTexts["NativeMacOne.local"].waitForExistence(timeout: 8))
        closeVisibleSheet()

        XCTAssertTrue(sessionButton("修复原生登录流程").waitForExistence(timeout: 8))
        XCTAssertTrue(sessionButton("运行原生支付测试").exists)
        keepScreenshot(named: "02-first-mac-sessions")

        button(startingWith: "Codex ").tap()
        XCTAssertTrue(sessionButton("运行原生支付测试").waitForExistence(timeout: 3))
        XCTAssertFalse(sessionButton("修复原生登录流程").exists)

        app.buttons["全部"].tap()
        app.buttons["搜索历史会话"].tap()
        XCTAssertTrue(app.buttons["新会话"].waitForNonExistence(timeout: 2))
        let searchField = app.textFields.firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 3))
        searchField.tap()
        searchField.typeText("支付")
        XCTAssertTrue(sessionButton("运行原生支付测试").waitForExistence(timeout: 3))
        XCTAssertFalse(sessionButton("修复原生登录流程").exists)
        app.buttons["关闭历史搜索"].tap()

        XCTAssertTrue(app.buttons["新会话"].waitForExistence(timeout: 3))
        app.buttons["新会话"].tap()
        let promptField = app.textViews.firstMatch
        XCTAssertTrue(promptField.waitForExistence(timeout: 3))
        promptField.tap()
        promptField.typeText("验证 Simulator 原生创建与流式输出")
        dismissKeyboard()
        app.buttons["启动会话"].tap()

        XCTAssertTrue(staticText(containing: "Simulator 分析结果").waitForExistence(timeout: 8))
        XCTAssertFalse(app.buttons["设备"].exists)
        XCTAssertTrue(app.buttons["返回会话列表"].exists)
        keepScreenshot(named: "03-full-screen-markdown-stream")

        let reportLink = app.links["检查报告"]
        XCTAssertTrue(reportLink.waitForExistence(timeout: 5))
        reportLink.tap()
        XCTAssertTrue(staticText(containing: "Simulator 文件读取通过").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["返回会话内容"].exists)
        keepScreenshot(named: "04-session-markdown-file-preview")
        XCTAssertTrue(app.buttons["下载 Simulator 检查报告.md"].exists)
        app.buttons["返回会话内容"].tap()

        let htmlLink = app.links["HTML 效果页"]
        XCTAssertTrue(htmlLink.waitForExistence(timeout: 5))
        htmlLink.tap()
        XCTAssertTrue(staticText(containing: "HTML 内置预览通过").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["下载 Simulator 效果页.html"].exists)
        keepScreenshot(named: "05-session-html-file-preview")
        app.buttons["返回会话内容"].tap()

        let inlineImage = app.buttons["全屏查看 Simulator 效果图"]
        XCTAssertTrue(inlineImage.waitForExistence(timeout: 5))
        inlineImage.tap()
        XCTAssertTrue(app.staticTexts["Simulator 效果图.png"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.images["Simulator 效果图.png"].exists)
        keepScreenshot(named: "06-session-image-file-preview")
        app.buttons["返回会话内容"].tap()

        let replyField = app.textFields.firstMatch
        XCTAssertTrue(replyField.waitForExistence(timeout: 3))
        replyField.tap()
        replyField.typeText("继续核对原生流")
        dismissKeyboard()
        app.buttons["发送指令"].tap()
        XCTAssertTrue(staticText(containing: "继续任务已完成").waitForExistence(timeout: 8))
        app.buttons["返回会话列表"].tap()

        app.buttons["设备"].tap()
        XCTAssertTrue(app.buttons["添加另一台 Mac"].waitForExistence(timeout: 3))
        app.buttons["添加另一台 Mac"].tap()
        try pairVisibleGateway(port: 17832, verifyRejectedCode: false)
        XCTAssertTrue(app.staticTexts["NativeMacTwo.local"].waitForExistence(timeout: 8))
        closeVisibleSheet()
        XCTAssertTrue(sessionButton("第二台 Mac 原生会话").waitForExistence(timeout: 8))
        XCTAssertFalse(sessionButton("修复原生登录流程").exists)
        keepScreenshot(named: "07-second-mac-active")

        try setGatewayDelay(3_500, port: 17832)
        app.terminate()
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(sessionButton("第二台 Mac 原生会话").waitForExistence(timeout: 3))
        XCTAssertTrue(staticText(containing: "正在同步最新会话").waitForExistence(timeout: 3))
        keepScreenshot(named: "08-cold-start-cache-refresh")
        try setGatewayDelay(0, port: 17832)

        app.buttons["设备"].tap()
        XCTAssertTrue(app.buttons["切换"].waitForExistence(timeout: 4))
        app.buttons["切换"].tap()
        XCTAssertTrue(sessionButton("修复原生登录流程").waitForExistence(timeout: 8))
        XCTAssertFalse(sessionButton("第二台 Mac 原生会话").exists)

        app.buttons["设备"].tap()
        XCTAssertTrue(app.buttons["从本机移除此 Mac"].waitForExistence(timeout: 4))
        app.buttons["从本机移除此 Mac"].tap()
        XCTAssertTrue(app.staticTexts["NativeMacTwo.local"].waitForExistence(timeout: 8))
        closeVisibleSheet()
        XCTAssertTrue(sessionButton("第二台 Mac 原生会话").waitForExistence(timeout: 8))

        app.buttons["设备"].tap()
        XCTAssertTrue(app.buttons["从本机移除此 Mac"].waitForExistence(timeout: 4))
        app.buttons["从本机移除此 Mac"].tap()
        XCTAssertTrue(app.staticTexts["连接 Mac 后查看真实会话"].waitForExistence(timeout: 8))
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "label == %@", "连接 Mac")).count,
            1
        )
        keepScreenshot(named: "09-all-local-connections-removed")
    }

    // [PAIR-002] A rejected one-time challenge remains on the pairing form and
    // never creates a saved native connection.
    func testInvalidPairingCodeIsRejected() throws {
        pairingCode = try fetchPairingCode(port: 17831)
        XCTAssertTrue(app.staticTexts["连接 Mac 后查看真实会话"].waitForExistence(timeout: 8))
        app.buttons["连接 Mac"].tap()
        XCTAssertTrue(app.staticTexts["Mac 网关地址"].waitForExistence(timeout: 4))
        let urlField = app.textFields.firstMatch
        let codeField = app.secureTextFields.firstMatch
        replaceText(in: urlField, with: "http://127.0.0.1:17831")
        let rejectedCode = pairingCode == "100000" ? "999999" : "100000"
        replaceText(in: codeField, with: rejectedCode)
        submitPairing(expecting: "配对码无效或已过期")
        XCTAssertTrue(app.buttons["配对并保存连接"].exists)
        XCTAssertFalse(app.staticTexts["NativeMacOne.local"].exists)
        keepScreenshot(named: "02-invalid-pairing-rejected")
    }

    // [MOBILE-001] Full-size iPad windows keep primary controls inside the
    // visible viewport in portrait and landscape.
    func testIPadAdaptiveLayout() throws {
        guard app.frame.width >= 700 else {
            throw XCTSkip("iPad-only adaptive layout coverage")
        }

        XCTAssertTrue(app.staticTexts["连接 Mac 后查看真实会话"].waitForExistence(timeout: 8))
        assertPrimaryControlsInsideViewport()
        keepScreenshot(named: "01-ipad-portrait")

        XCUIDevice.shared.orientation = .landscapeLeft
        addTeardownBlock {
            XCUIDevice.shared.orientation = .portrait
        }
        let landscape = NSPredicate { object, _ in
            guard let device = object as? XCUIDevice else { return false }
            return device.orientation == .landscapeLeft || device.orientation == .landscapeRight
        }
        let rotationExpectation = XCTNSPredicateExpectation(
            predicate: landscape,
            object: XCUIDevice.shared
        )
        wait(for: [rotationExpectation], timeout: 5)
        assertPrimaryControlsInsideViewport()
        let landscapeScreenshot = XCUIScreen.main.screenshot()
        XCTAssertGreaterThan(
            landscapeScreenshot.image.size.width,
            landscapeScreenshot.image.size.height,
            "iPad screenshot did not rotate to landscape"
        )
        keepScreenshot(landscapeScreenshot, named: "02-ipad-landscape")
    }

    private func pairVisibleGateway(port: Int, verifyRejectedCode: Bool) throws {
        XCTAssertTrue(app.staticTexts["Mac 网关地址"].waitForExistence(timeout: 4))
        let urlField = app.textFields.firstMatch
        let codeField = app.secureTextFields.firstMatch
        XCTAssertTrue(urlField.exists)
        XCTAssertTrue(codeField.exists)

        replaceText(in: urlField, with: "http://127.0.0.1:\(port)")
        XCTAssertEqual(urlField.value as? String, "http://127.0.0.1:\(port)")
        if verifyRejectedCode {
            let rejectedCode = pairingCode == "100000" ? "999999" : "100000"
            replaceText(in: codeField, with: rejectedCode)
            submitPairing(expecting: "配对码无效或已过期")
            closeVisibleSheet()
            app.buttons["连接 Mac"].tap()
            XCTAssertTrue(app.staticTexts["Mac 网关地址"].waitForExistence(timeout: 4))
            XCTAssertEqual(urlField.value as? String, "http://127.0.0.1:\(port)")
        }

        replaceText(in: codeField, with: pairingCode)
        submitPairing(expecting: "Mac 配对成功")
    }

    private func submitPairing(expecting resultText: String) {
        dismissKeyboard()
        let button = app.buttons["配对并保存连接"]
        button.tap()
        if app.staticTexts[resultText].waitForExistence(timeout: 2) { return }
        if button.exists {
            button.tap()
        }
        XCTAssertTrue(app.staticTexts[resultText].waitForExistence(timeout: 5))
    }

    private func dismissKeyboard() {
        let keyboard = app.keyboards.firstMatch
        guard keyboard.exists else { return }
        let hideKeyboardButton = keyboard.buttons["Hide keyboard"]
        if hideKeyboardButton.exists {
            hideKeyboardButton.tap()
            if keyboard.waitForNonExistence(timeout: 2) {
                blurFocusedFieldOnIPad()
                return
            }
        }
        let doneButton = app.buttons["Done"]
        if doneButton.exists {
            doneButton.tap()
            if keyboard.waitForNonExistence(timeout: 2) {
                blurFocusedFieldOnIPad()
                return
            }
        }
        keyboard.swipeDown()
        if keyboard.waitForNonExistence(timeout: 2) {
            blurFocusedFieldOnIPad()
            return
        }

        // Full-size iPad sheets leave a large dismissing backdrop above their
        // centered content. Do not use the phone fallback tap there; action
        // buttons remain reachable above the system keyboard.
        guard app.frame.width < 700 else { return }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.22)).tap()
        _ = keyboard.waitForNonExistence(timeout: 2)
    }

    private func blurFocusedFieldOnIPad() {
        guard app.frame.width >= 700 else { return }
        for label in ["发起新会话", "Mac 网关地址"] {
            let target = app.staticTexts[label]
            if target.exists {
                target.tap()
                return
            }
        }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
    }

    private func replaceText(in field: XCUIElement, with text: String) {
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 64))
        field.typeText(text)
    }

    private func closeVisibleSheet() {
        dismissKeyboard()
        XCTAssertTrue(app.buttons["关闭设备管理"].waitForExistence(timeout: 2))
        app.buttons["关闭设备管理"].tap()
        _ = app.buttons["添加另一台 Mac"].waitForNonExistence(timeout: 2)
    }

    private func button(startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func sessionButton(_ title: String) -> XCUIElement {
        app.buttons["打开会话：\(title)"]
    }

    private func staticText(containing fragment: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    private func assertPrimaryControlsInsideViewport() {
        let appFrame = app.frame
        let controls = [
            app.buttons["搜索历史会话"],
            button(startingWith: "Codex "),
            app.buttons["连接 Mac"],
            app.buttons["设置"],
        ]
        for control in controls {
            XCTAssertTrue(control.waitForExistence(timeout: 3))
            XCTAssertTrue(appFrame.contains(control.frame), "\(control) escaped \(appFrame)")
        }
    }

    private func keepScreenshot(named name: String) {
        keepScreenshot(XCUIScreen.main.screenshot(), named: name)
    }

    private func keepScreenshot(_ screenshot: XCUIScreenshot, named name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func setGatewayDelay(_ delayMs: Int, port: Int) throws {
        let expectation = expectation(description: "configure gateway \(port)")
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/__control")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["delayMs": delayMs])
        var resultError: Error?
        URLSession.shared.dataTask(with: request) { _, response, error in
            resultError = error
            if let response = response as? HTTPURLResponse, response.statusCode != 200 {
                resultError = NSError(
                    domain: "RemoteAgentUITests",
                    code: response.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "gateway control failed"]
                )
            }
            expectation.fulfill()
        }.resume()
        wait(for: [expectation], timeout: 5)
        if let resultError { throw resultError }
    }

    private func fetchPairingCode(port: Int) throws -> String {
        let url = URL(string: "http://127.0.0.1:\(port)/__pairing-code")!
        let expectation = expectation(description: "fetch pairing challenge \(port)")
        var resultData: Data?
        var resultError: Error?
        URLSession.shared.dataTask(with: url) { data, response, error in
            resultData = data
            resultError = error
            if let response = response as? HTTPURLResponse, response.statusCode != 200 {
                resultError = NSError(
                    domain: "RemoteAgentUITests",
                    code: response.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "fixture pairing challenge failed"]
                )
            }
            expectation.fulfill()
        }.resume()
        wait(for: [expectation], timeout: 5)
        if let resultError { throw resultError }
        guard let data = resultData else {
            throw NSError(
                domain: "RemoteAgentUITests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "fixture pairing challenge unavailable"]
            )
        }
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let body = payload?["data"] as? [String: Any]
        guard let code = body?["pairingCode"] as? String else {
            throw NSError(
                domain: "RemoteAgentUITests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "fixture pairing challenge unavailable"]
            )
        }
        return code
    }
}
