import Capacitor

@objc(MyViewController)
class MyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureCredentialsPlugin())
    }
}
