#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include <node_api.h>
#include <cstdint>
#include <cstring>
#include <string>

@interface DSHComposerGlassView : NSGlassEffectView
@end

@implementation DSHComposerGlassView
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

@interface DSHComposerGlassPanel : NSPanel
@property(nonatomic, strong) DSHComposerGlassView *glassView;
@end

@implementation DSHComposerGlassPanel
- (BOOL)canBecomeKeyWindow {
  return NO;
}
- (BOOL)canBecomeMainWindow {
  return NO;
}
@end

@interface DSHSidebarButtonGlassView : NSGlassEffectView
@property(nonatomic, strong) NSTextField *titleLabel;
@property(nonatomic, strong) NSImageView *iconView;
@property(nonatomic, strong) NSView *modalMaskView;
@property(nonatomic, strong) NSLayoutConstraint *iconWidthConstraint;
@property(nonatomic, strong) NSLayoutConstraint *iconHeightConstraint;
@property(nonatomic, strong) NSLayoutConstraint *contentLeadingConstraint;
@property(nonatomic, strong) NSLayoutConstraint *contentTrailingConstraint;
@property(nonatomic) BOOL baseHidden;
@end

@implementation DSHSidebarButtonGlassView
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

@interface DSHScrollButtonGlassView : NSGlassEffectView
@property(nonatomic, strong) NSView *depthView;
@property(nonatomic, strong) NSImageView *iconView;
@property(nonatomic, strong) NSView *modalMaskView;
@property(nonatomic) BOOL baseHidden;
@end

@implementation DSHScrollButtonGlassView
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

@interface DSHModalMaskState : NSObject
@property(nonatomic) BOOL visible;
@property(nonatomic) CGFloat alpha;
@end

@implementation DSHModalMaskState
@end

namespace {

char kComposerGlassPanelAssociationKey;
char kSidebarButtonGlassAssociationKey;
char kScrollButtonGlassAssociationKey;
char kModalMaskStateAssociationKey;
char kTrafficLightStateAssociationKey;
// AppKit's 24pt continuous clip is the visual match for Chromium's 36px
// squircle. Its internal glass material reads optically rounder, so let that
// material extend farther into the corners before the 24pt clip trims it.
constexpr CGFloat kComposerGlassClipCornerRadius = 24.0;
constexpr CGFloat kComposerGlassMaterialCornerRadius = 20.0;
constexpr CGFloat kComposerGlassStrokeWidth = 0.5;
constexpr CGFloat kComposerPanelOverflow = 112.0;
constexpr CGFloat kSidebarButtonCornerRadius = 12.0;
constexpr CGFloat kScrollButtonDiameter = 36.0;
constexpr CGFloat kTrafficLightCenterSpacing = 23.0;

NSImage *MessageSquarePlusLibraryImage() {
  NSString *svg =
      @"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" "
       @"fill=\"none\" stroke=\"#000\" stroke-width=\"2\" "
       @"stroke-linecap=\"round\" stroke-linejoin=\"round\">"
       @"<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\"/>"
       @"<path d=\"M12 8v6\"/>"
       @"<path d=\"M9 11h6\"/>"
       @"</svg>";
  NSImage *image = [[NSImage alloc]
      initWithData:[svg dataUsingEncoding:NSUTF8StringEncoding]];
  [image setTemplate:YES];
  image.accessibilityDescription = @"New Session";
  return image;
}

DSHModalMaskState *ModalMaskState(NSView *hostView) {
  DSHModalMaskState *state =
      objc_getAssociatedObject(hostView, &kModalMaskStateAssociationKey);
  if (state != nil) return state;
  state = [[DSHModalMaskState alloc] init];
  state.visible = NO;
  state.alpha = 0.24;
  objc_setAssociatedObject(hostView, &kModalMaskStateAssociationKey, state,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return state;
}

NSView *UpdateModalMaskView(NSView *hostView, NSView *contentView,
                            NSView *maskView) {
  if (contentView == nil) return nil;
  DSHModalMaskState *state = ModalMaskState(hostView);
  if (maskView == nil && !state.visible) return nil;
  if (maskView == nil) {
    maskView = [[NSView alloc] initWithFrame:contentView.bounds];
    maskView.wantsLayer = YES;
    maskView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [contentView addSubview:maskView positioned:NSWindowAbove relativeTo:nil];
  }
  maskView.frame = contentView.bounds;
  maskView.layer.backgroundColor =
      [NSColor colorWithWhite:0.0 alpha:state.alpha].CGColor;
  maskView.hidden = !state.visible;
  return maskView;
}

NSImage *ChevronDownLibraryImage() {
  NSString *svg =
      @"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" "
       @"fill=\"none\" stroke=\"#000\" stroke-width=\"2\" "
       @"stroke-linecap=\"round\" stroke-linejoin=\"round\">"
       @"<path d=\"m6 9 6 6 6-6\"/>"
       @"</svg>";
  NSImage *image = [[NSImage alloc]
      initWithData:[svg dataUsingEncoding:NSUTF8StringEncoding]];
  [image setTemplate:YES];
  image.accessibilityDescription = @"Scroll to bottom";
  return image;
}

void Throw(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
}

NSView *ViewFromHandle(napi_env env, napi_value value) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) {
    Throw(env, "Expected an Electron native window handle Buffer.");
    return nil;
  }

  void *bytes = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &bytes, &length) != napi_ok ||
      length < sizeof(NSView *)) {
    Throw(env, "Electron native window handle is invalid.");
    return nil;
  }

  uintptr_t address = 0;
  std::memcpy(&address, bytes, sizeof(address));
  return (__bridge NSView *)reinterpret_cast<void *>(address);
}

NSWindow *WindowFromHandle(napi_env env, napi_value value) {
  NSView *hostView = ViewFromHandle(env, value);
  if (hostView == nil) return nil;
  NSWindow *window = hostView.window;
  if (window == nil) {
    Throw(env, "Electron native view is not attached to an NSWindow.");
    return nil;
  }
  return window;
}

bool NumberProperty(napi_env env, napi_value object, const char *name,
                    double *result) {
  napi_value key;
  napi_value value;
  if (napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &key) != napi_ok ||
      napi_get_property(env, object, key, &value) != napi_ok ||
      napi_get_value_double(env, value, result) != napi_ok) {
    Throw(env, "Composer glass frame contains an invalid number.");
    return false;
  }
  return true;
}

bool OptionalBoolProperty(napi_env env, napi_value object, const char *name,
                          bool *result) {
  napi_value value;
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return false;
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_boolean) {
    *result = false;
    return true;
  }
  return napi_get_value_bool(env, value, result) == napi_ok;
}

NSString *OptionalStringProperty(napi_env env, napi_value object,
                                 const char *name) {
  napi_value value;
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return nil;
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return nil;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return nil;
  }
  std::string buffer(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(),
                                 &length) != napi_ok) {
    return nil;
  }
  return [NSString stringWithUTF8String:buffer.c_str()];
}

void PlaceGlassView(NSView *hostView, NSView *glass, double x, double y,
                    double width, double height) {
  const CGFloat hostHeight = NSHeight(hostView.bounds);
  NSRect frameInHost = NSMakeRect(x, hostHeight - y - height, width, height);
  NSView *container = glass.superview;
  glass.frame = container == hostView
                    ? frameInHost
                    : [hostView convertRect:frameInHost toView:container];
  glass.hidden = width <= 0 || height <= 0;
}

NSRect ScreenRectForHostFrame(NSView *hostView, double x, double y,
                              double width, double height) {
  const CGFloat hostHeight = NSHeight(hostView.bounds);
  NSRect frameInHost = NSMakeRect(x, hostHeight - y - height, width, height);
  NSRect frameInWindow = [hostView convertRect:frameInHost toView:nil];
  return [hostView.window convertRectToScreen:frameInWindow];
}

void ConfigureComposerPanelContent(DSHComposerGlassPanel *panel) {
  NSView *root = [[NSView alloc] initWithFrame:NSZeroRect];
  root.wantsLayer = YES;
  root.layer.backgroundColor = NSColor.clearColor.CGColor;

  DSHComposerGlassView *glass =
      [[DSHComposerGlassView alloc] initWithFrame:NSZeroRect];
  glass.style = NSGlassEffectViewStyleRegular;
  glass.wantsLayer = YES;
  glass.cornerRadius = kComposerGlassMaterialCornerRadius;
  glass.layer.cornerRadius = kComposerGlassClipCornerRadius;
  glass.layer.cornerCurve = kCACornerCurveContinuous;
  glass.layer.masksToBounds = YES;
  // Draw the visible stroke on the same CALayer that owns the final glass
  // clip. Keeping both edges in one renderer avoids the hairline seam caused
  // by independently antialiased Chromium squircle and AppKit corner paths.
  glass.layer.borderWidth = kComposerGlassStrokeWidth;
  glass.layer.borderColor =
      [NSColor colorWithSRGBRed:(219.0 / 255.0)
                          green:(219.0 / 255.0)
                           blue:(219.0 / 255.0)
                          alpha:1.0].CGColor;
  // NSGlassEffectView recalculates tintColor from the owning window's active
  // appearance. This view lives in a deliberately nonactivating panel, so a
  // tintColor alone becomes dim again as soon as the foreground renderer is
  // shown. Keep the system material untinted and apply a fixed 60%
  // white depth treatment inside the clipped glass content instead.
  glass.tintColor = nil;
  NSView *glassContent = [[NSView alloc] initWithFrame:NSZeroRect];
  glassContent.wantsLayer = YES;
  glassContent.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  // Let NSGlassEffectView remain the only clipping owner. Giving the white
  // depth layer its own CALayer corner creates a second, subtly different
  // contour once the active-chat composer grows taller than the hero card.
  glassContent.layer.backgroundColor =
      [NSColor colorWithWhite:1.0 alpha:0.60].CGColor;
  glass.contentView = glassContent;
  [root addSubview:glass];

  panel.contentView = root;
  panel.glassView = glass;
}

DSHComposerGlassPanel *ComposerGlassPanel(NSWindow *parentWindow) {
  DSHComposerGlassPanel *panel = objc_getAssociatedObject(
      parentWindow, &kComposerGlassPanelAssociationKey);
  if (panel != nil) return panel;

  panel = [[DSHComposerGlassPanel alloc]
      initWithContentRect:NSZeroRect
                styleMask:(NSWindowStyleMaskBorderless |
                           NSWindowStyleMaskNonactivatingPanel)
                  backing:NSBackingStoreBuffered
                    defer:NO];
  panel.releasedWhenClosed = NO;
  panel.opaque = NO;
  panel.backgroundColor = NSColor.clearColor;
  panel.hasShadow = NO;
  panel.ignoresMouseEvents = YES;
  panel.hidesOnDeactivate = NO;
  panel.animationBehavior = NSWindowAnimationBehaviorNone;
  panel.collectionBehavior =
      NSWindowCollectionBehaviorTransient |
      NSWindowCollectionBehaviorIgnoresCycle |
      NSWindowCollectionBehaviorFullScreenAuxiliary;
  ConfigureComposerPanelContent(panel);
  [parentWindow addChildWindow:panel ordered:NSWindowAbove];
  objc_setAssociatedObject(parentWindow, &kComposerGlassPanelAssociationKey,
                           panel, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return panel;
}

void PlaceComposerGlassPanel(NSView *hostView, NSWindow *foregroundWindow,
                             DSHComposerGlassPanel *panel, double x, double y,
                             double width, double height) {
  if (width <= 0 || height <= 0) {
    [panel orderOut:nil];
    return;
  }

  NSRect cardScreenRect =
      ScreenRectForHostFrame(hostView, x, y, width, height);
  NSRect panelScreenRect = NSInsetRect(
      cardScreenRect, -kComposerPanelOverflow, -kComposerPanelOverflow);
  [panel setFrame:panelScreenRect display:NO];
  NSRect cardFrame = NSMakeRect(kComposerPanelOverflow,
                                kComposerPanelOverflow, width, height);
  panel.glassView.frame = cardFrame;
  panel.glassView.contentView.frame = panel.glassView.bounds;
  [panel.contentView layoutSubtreeIfNeeded];

  NSWindow *parentWindow = hostView.window;
  if (panel.parentWindow != parentWindow) {
    [panel.parentWindow removeChildWindow:panel];
    [parentWindow addChildWindow:panel ordered:NSWindowAbove];
  }
  // Ask AppKit for mouse movement while Electron keeps this child inactive.
  // The main process additionally forwards those coordinates into Chromium,
  // whose inactive renderer does not consume AppKit movement consistently.
  foregroundWindow.acceptsMouseMovedEvents = YES;
  [panel orderWindow:NSWindowAbove relativeTo:parentWindow.windowNumber];
  [foregroundWindow orderWindow:NSWindowAbove relativeTo:panel.windowNumber];
}

NSView *WindowFrameView(NSWindow *window) {
  return window.contentView.superview ?: window.contentView;
}

NSRect TrafficLightFrameInWindow(NSWindow *window, NSButton *button) {
  NSView *frameView = WindowFrameView(window);
  if (frameView == nil || button.superview == nil) return NSZeroRect;
  return [button.superview convertRect:button.frame toView:frameView];
}

void ApplyTrafficLightPosition(NSWindow *window, CGFloat x, CGFloat y) {
  NSView *frameView = WindowFrameView(window);
  if (frameView == nil) return;

  const NSWindowButton buttonTypes[] = {
      NSWindowCloseButton,
      NSWindowMiniaturizeButton,
      NSWindowZoomButton,
  };
  for (NSUInteger index = 0; index < 3; ++index) {
    NSButton *button = [window standardWindowButton:buttonTypes[index]];
    if (button == nil || button.superview == nil) continue;

    NSRect frameInWindow = TrafficLightFrameInWindow(window, button);
    frameInWindow.origin.x = NSMinX(frameView.bounds) + x +
                             index * kTrafficLightCenterSpacing;
    frameInWindow.origin.y = NSMaxY(frameView.bounds) - y -
                             NSHeight(frameInWindow);
    button.frame = [button.superview convertRect:frameInWindow
                                        fromView:frameView];
  }
}

bool TrafficLightPositionMatches(NSWindow *window, CGFloat x, CGFloat y) {
  NSView *frameView = WindowFrameView(window);
  NSButton *closeButton =
      [window standardWindowButton:NSWindowCloseButton];
  if (frameView == nil || closeButton == nil) return false;
  NSRect closeFrame = TrafficLightFrameInWindow(window, closeButton);
  const CGFloat actualX = NSMinX(closeFrame) - NSMinX(frameView.bounds);
  const CGFloat actualY = NSMaxY(frameView.bounds) - NSMaxY(closeFrame);
  return std::abs(actualX - x) < 0.01 && std::abs(actualY - y) < 0.01;
}

void CorrectTrafficLightPosition(NSWindow *window,
                                 NSMutableDictionary *state) {
  if (window == nil || state == nil || [state[@"applying"] boolValue]) return;
  const CGFloat x = [state[@"x"] doubleValue];
  const CGFloat y = [state[@"y"] doubleValue];
  if (TrafficLightPositionMatches(window, x, y)) return;

  state[@"applying"] = @YES;
  [WindowFrameView(window) layoutSubtreeIfNeeded];
  ApplyTrafficLightPosition(window, x, y);
  state[@"applying"] = @NO;
}

void ScheduleTrafficLightCorrection(NSWindow *window,
                                    NSMutableDictionary *state) {
  if (
      window == nil ||
      state == nil ||
      [state[@"applying"] boolValue] ||
      [state[@"scheduled"] boolValue] ||
      TrafficLightPositionMatches(
          window, [state[@"x"] doubleValue], [state[@"y"] doubleValue])) {
    return;
  }

  state[@"scheduled"] = @YES;
  __weak NSWindow *weakWindow = window;
  __weak NSMutableDictionary *weakState = state;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *currentState = weakState;
    currentState[@"scheduled"] = @NO;
    CorrectTrafficLightPosition(weakWindow, currentState);
  });
}

NSMutableDictionary *TrafficLightState(NSWindow *window) {
  NSMutableDictionary *state =
      objc_getAssociatedObject(window, &kTrafficLightStateAssociationKey);
  if (state != nil) return state;

  state = [@{
    @"x" : @0,
    @"y" : @0,
    @"applying" : @NO,
    @"scheduled" : @NO,
  } mutableCopy];
  objc_setAssociatedObject(window, &kTrafficLightStateAssociationKey, state,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  NSMutableArray *tokens = [NSMutableArray array];
  state[@"tokens"] = tokens;
  __weak NSWindow *weakWindow = window;
  __weak NSMutableDictionary *weakState = state;
  void (^schedule)(NSNotification *) = ^(NSNotification *notification) {
    ScheduleTrafficLightCorrection(weakWindow, weakState);
  };

  const NSWindowButton buttonTypes[] = {
      NSWindowCloseButton,
      NSWindowMiniaturizeButton,
      NSWindowZoomButton,
  };
  for (NSUInteger index = 0; index < 3; ++index) {
    NSButton *button = [window standardWindowButton:buttonTypes[index]];
    if (button == nil) continue;
    button.postsFrameChangedNotifications = YES;
    [tokens addObject:[center
        addObserverForName:NSViewFrameDidChangeNotification
                    object:button
                     queue:NSOperationQueue.mainQueue
                usingBlock:schedule]];
  }

  NSArray<NSNotificationName> *windowNotifications = @[
    NSWindowDidUpdateNotification,
    NSWindowDidResizeNotification,
    NSWindowDidBecomeKeyNotification,
    NSWindowDidResignKeyNotification,
    NSWindowDidChangeBackingPropertiesNotification,
  ];
  for (NSNotificationName name in windowNotifications) {
    [tokens addObject:[center addObserverForName:name
                                         object:window
                                          queue:NSOperationQueue.mainQueue
                                     usingBlock:schedule]];
  }
  [tokens addObject:[center
      addObserverForName:NSWindowWillCloseNotification
                  object:window
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(NSNotification *notification) {
                NSMutableDictionary *currentState = weakState;
                for (id token in [currentState[@"tokens"] copy]) {
                  [center removeObserver:token];
                }
                [currentState removeObjectForKey:@"tokens"];
                NSWindow *currentWindow = weakWindow;
                if (currentWindow != nil) {
                  objc_setAssociatedObject(
                      currentWindow, &kTrafficLightStateAssociationKey, nil,
                      OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                }
              }]];
  return state;
}

void SetDouble(napi_env env, napi_value object, const char *name,
               double value) {
  napi_value number;
  napi_create_double(env, value, &number);
  napi_set_named_property(env, object, name, number);
}

napi_value SetTrafficLightPosition(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    Throw(env, "setTrafficLightPosition requires a window handle and point.");
    return nullptr;
  }

  NSWindow *window = WindowFromHandle(env, argv[0]);
  if (window == nil) return nullptr;
  double x;
  double y;
  if (!NumberProperty(env, argv[1], "x", &x) ||
      !NumberProperty(env, argv[1], "y", &y)) {
    return nullptr;
  }
  NSMutableDictionary *state = TrafficLightState(window);
  state[@"x"] = @(x);
  state[@"y"] = @(y);
  state[@"applying"] = @YES;
  [WindowFrameView(window) layoutSubtreeIfNeeded];
  ApplyTrafficLightPosition(window, x, y);
  state[@"applying"] = @NO;
  ScheduleTrafficLightCorrection(window, state);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value GetTrafficLightMetrics(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    Throw(env, "getTrafficLightMetrics requires a window handle.");
    return nullptr;
  }

  NSWindow *window = WindowFromHandle(env, argv[0]);
  if (window == nil) return nullptr;
  NSView *frameView = WindowFrameView(window);
  NSButton *closeButton =
      [window standardWindowButton:NSWindowCloseButton];
  NSButton *minimizeButton =
      [window standardWindowButton:NSWindowMiniaturizeButton];
  if (frameView == nil || closeButton == nil || minimizeButton == nil) {
    Throw(env, "The NSWindow traffic lights are unavailable.");
    return nullptr;
  }

  NSRect closeFrame = TrafficLightFrameInWindow(window, closeButton);
  NSRect minimizeFrame = TrafficLightFrameInWindow(window, minimizeButton);
  napi_value result;
  napi_create_object(env, &result);
  SetDouble(env, result, "x",
            NSMinX(closeFrame) - NSMinX(frameView.bounds));
  SetDouble(env, result, "y",
            NSMaxY(frameView.bounds) - NSMaxY(closeFrame));
  SetDouble(env, result, "width", NSWidth(closeFrame));
  SetDouble(env, result, "height", NSHeight(closeFrame));
  SetDouble(env, result, "centerSpacing",
            NSMidX(minimizeFrame) - NSMidX(closeFrame));
  return result;
}

napi_value SetComposerGlassPanelFrame(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 3) {
    Throw(env,
          "setComposerGlassPanelFrame requires parent/foreground handles and "
          "a frame.");
    return nullptr;
  }

  NSView *hostView = ViewFromHandle(env, argv[0]);
  if (hostView == nil) return nullptr;
  NSWindow *parentWindow = hostView.window;
  NSWindow *foregroundWindow = WindowFromHandle(env, argv[1]);
  if (parentWindow == nil || foregroundWindow == nil) return nullptr;

  if (@available(macOS 26.0, *)) {
    double x;
    double y;
    double width;
    double height;
    if (!NumberProperty(env, argv[2], "x", &x) ||
        !NumberProperty(env, argv[2], "y", &y) ||
        !NumberProperty(env, argv[2], "width", &width) ||
        !NumberProperty(env, argv[2], "height", &height)) {
      return nullptr;
    }

    DSHComposerGlassPanel *panel = ComposerGlassPanel(parentWindow);
    PlaceComposerGlassPanel(hostView, foregroundWindow, panel, x, y, width,
                            height);
  } else {
    Throw(env, "Native composer Liquid Glass requires macOS 26 or later.");
    return nullptr;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value SetSidebarButtonGlassFrame(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    Throw(env, "setSidebarButtonGlassFrame requires a window handle and frame.");
    return nullptr;
  }

  NSView *hostView = ViewFromHandle(env, argv[0]);
  if (hostView == nil) return nullptr;

  if (@available(macOS 26.0, *)) {
    double x;
    double y;
    double width;
    double height;
    if (!NumberProperty(env, argv[1], "x", &x) ||
        !NumberProperty(env, argv[1], "y", &y) ||
        !NumberProperty(env, argv[1], "width", &width) ||
        !NumberProperty(env, argv[1], "height", &height)) {
      return nullptr;
    }

    DSHSidebarButtonGlassView *glass = objc_getAssociatedObject(
        hostView, &kSidebarButtonGlassAssociationKey);
    if (glass == nil) {
      glass = [[DSHSidebarButtonGlassView alloc] initWithFrame:NSZeroRect];
      glass.style = NSGlassEffectViewStyleRegular;
      glass.wantsLayer = YES;
      glass.cornerRadius = kSidebarButtonCornerRadius;
      glass.layer.cornerRadius = kSidebarButtonCornerRadius;
      glass.layer.cornerCurve = kCACornerCurveContinuous;
      glass.layer.masksToBounds = YES;
      glass.autoresizingMask = NSViewNotSizable;

      NSImageView *icon = [[NSImageView alloc] initWithFrame:NSZeroRect];
      icon.translatesAutoresizingMaskIntoConstraints = NO;
      icon.contentTintColor = NSColor.labelColor;
      icon.imageScaling = NSImageScaleProportionallyUpOrDown;
      icon.image = MessageSquarePlusLibraryImage();
      glass.iconView = icon;
      glass.iconWidthConstraint =
          [icon.widthAnchor constraintEqualToConstant:14.0];
      glass.iconHeightConstraint =
          [icon.heightAnchor constraintEqualToConstant:14.0];
      [NSLayoutConstraint activateConstraints:@[
        glass.iconWidthConstraint,
        glass.iconHeightConstraint,
      ]];

      NSTextField *label = [NSTextField labelWithString:@"New Session"];
      label.translatesAutoresizingMaskIntoConstraints = NO;
      label.font = [NSFont systemFontOfSize:14.0 weight:NSFontWeightRegular];
      label.textColor = NSColor.labelColor;
      label.lineBreakMode = NSLineBreakByTruncatingTail;
      glass.titleLabel = label;

      NSStackView *content = [NSStackView stackViewWithViews:@[ icon, label ]];
      content.translatesAutoresizingMaskIntoConstraints = NO;
      content.orientation = NSUserInterfaceLayoutOrientationHorizontal;
      content.alignment = NSLayoutAttributeCenterY;
      content.spacing = 8.0;
      NSView *contentView = [[NSView alloc] initWithFrame:NSZeroRect];
      contentView.wantsLayer = YES;
      contentView.layer.backgroundColor = NSColor.clearColor.CGColor;
      [contentView addSubview:content];
      glass.contentLeadingConstraint =
          [content.leadingAnchor constraintGreaterThanOrEqualToAnchor:contentView.leadingAnchor
                                                               constant:16.0];
      glass.contentTrailingConstraint =
          [content.trailingAnchor constraintLessThanOrEqualToAnchor:contentView.trailingAnchor
                                                             constant:-16.0];
      [NSLayoutConstraint activateConstraints:@[
        [content.centerXAnchor constraintEqualToAnchor:contentView.centerXAnchor],
        [content.centerYAnchor constraintEqualToAnchor:contentView.centerYAnchor],
        glass.contentLeadingConstraint,
        glass.contentTrailingConstraint,
      ]];
      glass.contentView = contentView;

      NSView *container = hostView.superview ?: hostView;
      NSView *relativeView = hostView.superview == nil ? nil : hostView;
      [container addSubview:glass positioned:NSWindowAbove relativeTo:relativeView];
      objc_setAssociatedObject(hostView, &kSidebarButtonGlassAssociationKey,
                               glass, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    NSString *title = OptionalStringProperty(env, argv[1], "title");
    if (title.length > 0) glass.titleLabel.stringValue = title;
    bool hovered = false;
    bool pressed = false;
    bool compact = false;
    OptionalBoolProperty(env, argv[1], "hovered", &hovered);
    OptionalBoolProperty(env, argv[1], "pressed", &pressed);
    OptionalBoolProperty(env, argv[1], "compact", &compact);
    glass.titleLabel.hidden = compact;
    glass.contentLeadingConstraint.constant = compact ? 0.0 : 16.0;
    glass.contentTrailingConstraint.constant = compact ? 0.0 : -16.0;
    glass.iconWidthConstraint.constant = compact ? 18.0 : 14.0;
    glass.iconHeightConstraint.constant = compact ? 18.0 : 14.0;
    glass.tintColor = pressed
                          ? [NSColor colorWithWhite:1.0 alpha:0.24]
                          : hovered ? [NSColor colorWithWhite:1.0 alpha:0.16]
                                    : nil;
    glass.contentView.alphaValue = pressed ? 0.78 : 1.0;
    PlaceGlassView(hostView, glass, x, y, width, height);
    glass.baseHidden = compact || width <= 0 || height <= 0;
    glass.hidden = glass.baseHidden;
    glass.modalMaskView = UpdateModalMaskView(
        hostView, glass.contentView, glass.modalMaskView);
  } else {
    Throw(env, "Native sidebar Liquid Glass requires macOS 26 or later.");
    return nullptr;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value SetScrollButtonGlassFrame(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    Throw(env, "setScrollButtonGlassFrame requires a window handle and frame.");
    return nullptr;
  }

  NSView *hostView = ViewFromHandle(env, argv[0]);
  if (hostView == nil) return nullptr;

  if (@available(macOS 26.0, *)) {
    double x;
    double y;
    double width;
    double height;
    if (!NumberProperty(env, argv[1], "x", &x) ||
        !NumberProperty(env, argv[1], "y", &y) ||
        !NumberProperty(env, argv[1], "width", &width) ||
        !NumberProperty(env, argv[1], "height", &height)) {
      return nullptr;
    }

    DSHScrollButtonGlassView *glass = objc_getAssociatedObject(
        hostView, &kScrollButtonGlassAssociationKey);
    if (glass == nil) {
      glass = [[DSHScrollButtonGlassView alloc] initWithFrame:NSZeroRect];
      glass.style = NSGlassEffectViewStyleRegular;
      glass.tintColor = nil;
      glass.wantsLayer = YES;
      glass.autoresizingMask = NSViewNotSizable;
      glass.layer.masksToBounds = YES;

      NSView *content = [[NSView alloc] initWithFrame:NSZeroRect];
      content.wantsLayer = YES;
      content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

      NSView *depth = [[NSView alloc] initWithFrame:NSZeroRect];
      depth.wantsLayer = YES;
      depth.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      depth.layer.backgroundColor =
          [NSColor colorWithWhite:1.0 alpha:0.40].CGColor;
      [content addSubview:depth];
      glass.depthView = depth;

      NSImageView *icon = [[NSImageView alloc] initWithFrame:NSZeroRect];
      icon.contentTintColor = NSColor.labelColor;
      icon.imageScaling = NSImageScaleProportionallyUpOrDown;
      icon.image = ChevronDownLibraryImage();
      [content addSubview:icon];
      glass.iconView = icon;
      glass.contentView = content;

      NSView *container = hostView.superview ?: hostView;
      NSView *relativeView = hostView.superview == nil ? nil : hostView;
      [container addSubview:glass positioned:NSWindowAbove relativeTo:relativeView];
      objc_setAssociatedObject(hostView, &kScrollButtonGlassAssociationKey,
                               glass, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    const CGFloat diameter = MIN(width, height);
    const CGFloat radius = diameter > 0 ? diameter / 2.0
                                        : kScrollButtonDiameter / 2.0;
    glass.cornerRadius = radius;
    glass.layer.cornerRadius = radius;
    glass.layer.cornerCurve = kCACornerCurveContinuous;
    bool hovered = false;
    bool pressed = false;
    OptionalBoolProperty(env, argv[1], "hovered", &hovered);
    OptionalBoolProperty(env, argv[1], "pressed", &pressed);
    // Keep the same fixed 40% white depth layer as the Composer. Interaction
    // feedback is a separate system tint so the shared material never drifts.
    glass.depthView.layer.backgroundColor =
        [NSColor colorWithWhite:1.0 alpha:0.40].CGColor;
    glass.tintColor = pressed
                          ? [NSColor colorWithWhite:1.0 alpha:0.12]
                          : hovered ? [NSColor colorWithWhite:1.0 alpha:0.06]
                                    : nil;
    glass.iconView.alphaValue = pressed ? 0.78 : 1.0;
    PlaceGlassView(hostView, glass, x, y, width, height);
    glass.contentView.frame = glass.bounds;
    glass.depthView.frame = glass.contentView.bounds;
    const CGFloat iconSize = 16.0;
    glass.iconView.frame = NSMakeRect((width - iconSize) / 2.0,
                                      (height - iconSize) / 2.0,
                                      iconSize, iconSize);
    glass.baseHidden = width <= 0 || height <= 0;
    glass.hidden = glass.baseHidden;
    glass.modalMaskView = UpdateModalMaskView(
        hostView, glass.contentView, glass.modalMaskView);
  } else {
    Throw(env, "Native scroll button Liquid Glass requires macOS 26 or later.");
    return nullptr;
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value SetModalMask(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    Throw(env, "setModalMask requires a window handle and state.");
    return nullptr;
  }

  NSView *hostView = ViewFromHandle(env, argv[0]);
  if (hostView == nil) return nullptr;
  bool visible = false;
  double alpha = 0.24;
  if (!OptionalBoolProperty(env, argv[1], "visible", &visible) ||
      !NumberProperty(env, argv[1], "alpha", &alpha)) {
    return nullptr;
  }

  DSHModalMaskState *state = ModalMaskState(hostView);
  state.alpha = MAX(0.0, MIN(1.0, alpha));
  // Web-only menus suppress the Composer foreground with a zero-alpha state.
  // Only a real modal should occlude the native controls.
  state.visible = visible && state.alpha > 0.0;

  DSHSidebarButtonGlassView *sidebarGlass = objc_getAssociatedObject(
      hostView, &kSidebarButtonGlassAssociationKey);
  if (sidebarGlass != nil) {
    sidebarGlass.modalMaskView = UpdateModalMaskView(
        hostView, sidebarGlass.contentView, sidebarGlass.modalMaskView);
  }
  DSHScrollButtonGlassView *scrollGlass = objc_getAssociatedObject(
      hostView, &kScrollButtonGlassAssociationKey);
  if (scrollGlass != nil) {
    scrollGlass.modalMaskView = UpdateModalMaskView(
        hostView, scrollGlass.contentView, scrollGlass.modalMaskView);
  }

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value RemoveComposerGlassPanel(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    Throw(env, "removeComposerGlassPanel requires a window handle.");
    return nullptr;
  }

  NSWindow *parentWindow = WindowFromHandle(env, argv[0]);
  if (parentWindow == nil) return nullptr;

  DSHComposerGlassPanel *panel = objc_getAssociatedObject(
      parentWindow, &kComposerGlassPanelAssociationKey);
  if (panel != nil) {
    [parentWindow removeChildWindow:panel];
    [panel orderOut:nil];
    [panel close];
  }
  objc_setAssociatedObject(parentWindow, &kComposerGlassPanelAssociationKey, nil,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value RemoveSidebarButtonGlass(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    Throw(env, "removeSidebarButtonGlass requires a window handle.");
    return nullptr;
  }

  NSView *hostView = ViewFromHandle(env, argv[0]);
  if (hostView == nil) return nullptr;

  NSView *glass = objc_getAssociatedObject(hostView,
                                            &kSidebarButtonGlassAssociationKey);
  [glass removeFromSuperview];
  objc_setAssociatedObject(hostView, &kSidebarButtonGlassAssociationKey, nil,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value RemoveScrollButtonGlass(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 1) {
    Throw(env, "removeScrollButtonGlass requires a window handle.");
    return nullptr;
  }

  NSView *hostView = ViewFromHandle(env, argv[0]);
  if (hostView == nil) return nullptr;

  NSView *glass = objc_getAssociatedObject(hostView,
                                            &kScrollButtonGlassAssociationKey);
  [glass removeFromSuperview];
  objc_setAssociatedObject(hostView, &kScrollButtonGlassAssociationKey, nil,
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"setTrafficLightPosition", nullptr, SetTrafficLightPosition, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"getTrafficLightMetrics", nullptr, GetTrafficLightMetrics, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"setComposerGlassPanelFrame", nullptr, SetComposerGlassPanelFrame,
       nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setSidebarButtonGlassFrame", nullptr, SetSidebarButtonGlassFrame,
       nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setScrollButtonGlassFrame", nullptr, SetScrollButtonGlassFrame,
       nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setModalMask", nullptr, SetModalMask, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"removeComposerGlassPanel", nullptr, RemoveComposerGlassPanel, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"removeSidebarButtonGlass", nullptr, RemoveSidebarButtonGlass, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"removeScrollButtonGlass", nullptr, RemoveScrollButtonGlass, nullptr,
       nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]),
                         properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
