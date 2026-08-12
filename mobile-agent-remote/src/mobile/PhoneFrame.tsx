import {
  createContext,
  type CSSProperties,
  type DragEvent,
  type PropsWithChildren,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { DevicePicker, useMobileDevice } from "./Device";
import { useMobileCursor } from "./MobileCursor";

type ScreenPortalContextValue = {
  screenRef: RefObject<HTMLDivElement | null>;
};

const ScreenPortalContext = createContext<ScreenPortalContextValue | null>(null);

function suppressNativeDrag(event: DragEvent<HTMLElement>) {
  if (event.target instanceof Element && event.target.closest('[data-native-drag="true"]')) {
    return;
  }

  event.preventDefault();
}

export function useScreenPortal() {
  const context = useContext(ScreenPortalContext);

  if (!context) {
    throw new Error("useScreenPortal must be used inside PhoneFrame");
  }

  return context;
}

function getDeviceScale(deviceWidth: number, deviceHeight: number) {
  if (typeof window === "undefined") return 1;

  const horizontal = (window.innerWidth - 48) / deviceWidth;
  const vertical = (window.innerHeight - 48) / deviceHeight;

  return Math.max(0.42, Math.min(horizontal, vertical, 1));
}

function useDeviceScale(deviceWidth: number, deviceHeight: number) {
  const [scale, setScale] = useState(() => getDeviceScale(deviceWidth, deviceHeight));

  useEffect(() => {
    const update = () => setScale(getDeviceScale(deviceWidth, deviceHeight));

    update();
    window.addEventListener("resize", update);

    return () => window.removeEventListener("resize", update);
  }, [deviceHeight, deviceWidth]);

  return scale;
}

export function PhoneFrame({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const { geometry } = device;
  const scale = useDeviceScale(geometry.device.width, geometry.device.height);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const contextValue = useMemo(() => ({ screenRef }), []);
  const mobileCursor = useMobileCursor();
  const native = Capacitor.isNativePlatform();

  return (
    <ScreenPortalContext.Provider value={contextValue}>
      <div className={`phone-stage ${native ? "is-native" : ""}`}>
        {native ? null : <DevicePicker />}
        <div
          className={`phone-scale-box ${native ? "is-native" : ""}`}
          style={{
            width: native ? "100%" : geometry.device.width * scale,
            height: native ? "100%" : geometry.device.height * scale,
          }}
        >
          <div
            className={`phone-device ${native ? "is-native" : ""}`}
            data-device={device.id}
            data-platform={device.platform}
            data-testid="phone-frame"
            onDragStartCapture={native ? undefined : suppressNativeDrag}
            style={{
              width: native ? "100%" : geometry.device.width,
              height: native ? "100%" : geometry.device.height,
              transform: native ? "none" : `scale(${scale})`,
            }}
          >
            {native ? null : <img
              className="phone-bezel"
              src={device.bezel}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{ zIndex: device.bezelLayer === "above-screen" ? 2 : 1 }}
            />}
            <div
              ref={screenRef}
              className={`device-screen ${native ? "is-native" : ""}`}
              data-cursor-debug={mobileCursor.cursorDebug ? "true" : "false"}
              data-device={device.id}
              data-phone-screen
              data-testid="device-screen"
              {...(native ? {} : mobileCursor.cursorHandlers)}
              style={
                {
                  "--device-safe-area-bottom": `${geometry.safeArea.bottom}px`,
                  left: native ? 0 : geometry.screen.x,
                  top: native ? 0 : geometry.screen.y,
                  width: native ? "100%" : geometry.screen.width,
                  height: native ? "100%" : geometry.screen.height,
                  borderRadius: native ? 0 : geometry.screen.radius,
                  zIndex: native ? 1 : device.bezelLayer === "above-screen" ? 1 : 2,
                } as CSSProperties
              }
            >
              {children}
              {!native && device.camera ? (
                <span
                  className="device-camera"
                  data-testid="device-camera"
                  aria-hidden="true"
                  style={{
                    width: device.camera.size,
                    height: device.camera.size,
                    top: device.camera.top,
                    left: `calc(50% - ${device.camera.size / 2}px)`,
                  }}
                />
              ) : null}
              {native ? null : mobileCursor.cursorElement}
            </div>
          </div>
        </div>
      </div>
    </ScreenPortalContext.Provider>
  );
}
