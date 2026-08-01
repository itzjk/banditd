import { ImageResponse } from "next/og";

export const alt =
  "banditd, an agent that moves your ad budget to the ads that actually work";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

const BACKGROUND = "#08090a";
const FOREGROUND = "#f1f3f4";
const MUTED = "#9ba1a8";
const SUBTLE = "#7b828a";
const BORDER = "#1e2226";
const ACCENT = "#3fe08f";
const DANGER = "#ff6b6b";
const GRID = "rgba(255, 255, 255, 0.042)";

const VERTICAL_LINES = [120, 240, 360, 480, 600, 720, 840, 960, 1080];
const HORIZONTAL_LINES = [105, 210, 315, 420, 525];

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          backgroundColor: BACKGROUND,
        }}
      >
        {VERTICAL_LINES.map((x) => (
          <div
            key={`v${x}`}
            style={{
              position: "absolute",
              top: 0,
              left: x,
              width: 1,
              height: size.height,
              backgroundColor: GRID,
            }}
          />
        ))}
        {HORIZONTAL_LINES.map((y) => (
          <div
            key={`h${y}`}
            style={{
              position: "absolute",
              left: 0,
              top: y,
              width: size.width,
              height: 1,
              backgroundColor: GRID,
            }}
          />
        ))}

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "58px 64px 54px 64px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  backgroundColor: ACCENT,
                  marginRight: 22,
                }}
              />
              <div
                style={{
                  fontSize: 74,
                  letterSpacing: "-0.035em",
                  color: FOREGROUND,
                  lineHeight: 1,
                }}
              >
                banditd
              </div>
            </div>
            <div
              style={{
                fontSize: 19,
                letterSpacing: "0.2em",
                color: SUBTLE,
                textTransform: "uppercase",
              }}
            >
              Autonomous ad agent
            </div>
          </div>

          <div
            style={{
              display: "flex",
              maxWidth: 1000,
              fontSize: 45,
              lineHeight: 1.22,
              letterSpacing: "-0.02em",
              color: FOREGROUND,
            }}
          >
            Stop paying for ads that don’t work. banditd moves your budget to the ones
            that do.
          </div>

          <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <div style={{ display: "flex", width: "100%", height: 1, backgroundColor: BORDER }} />
            <div
              style={{
                display: "flex",
                fontSize: 18,
                letterSpacing: "0.18em",
                color: SUBTLE,
                textTransform: "uppercase",
                marginTop: 26,
              }}
            >
              False winner rate on two identical ads
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                width: "100%",
                marginTop: 22,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div
                  style={{
                    fontSize: 84,
                    lineHeight: 1,
                    letterSpacing: "-0.04em",
                    color: DANGER,
                  }}
                >
                  44.5%
                </div>
                <div style={{ display: "flex", fontSize: 21, color: MUTED, marginTop: 16 }}>
                  Probability rule alone
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  width: 1,
                  height: 122,
                  backgroundColor: BORDER,
                  marginLeft: 48,
                  marginRight: 56,
                }}
              />

              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div
                  style={{
                    fontSize: 84,
                    lineHeight: 1,
                    letterSpacing: "-0.04em",
                    color: ACCENT,
                  }}
                >
                  0.5%
                </div>
                <div style={{ display: "flex", fontSize: 21, color: MUTED, marginTop: 16 }}>
                  With banditd, over 200 runs
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
