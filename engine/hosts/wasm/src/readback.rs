//! How an export that reads pixels answers.
//!
//! An engine command that reads pixels back hands over a
//! [`Read`](lopsy_engine::gpu::read::Read) or is an `async fn` over a
//! [`Cx`](lopsy_engine::task::Cx). Either becomes a
//! [`Task`], and [`readback_export!`] turns one definition into the export
//! for each backend:
//!
//! - WebGL answers a read before it returns, so the task finishes in one
//!   poll and the export returns its value as any other export does. An
//!   export declared with [`deferred_readback_export!`] is the exception:
//!   its read waits for a fence (`gpu/webgl/read.rs`) and answers later,
//!   as on WebGPU.
//! - WebGPU answers later. The export returns the value if the task
//!   finished at once, and otherwise an object `{ lopsyTask, ready }`: JS
//!   awaits `ready` and calls `resumeTask(engine, lopsyTask)`, which
//!   returns the value or another such object (`asyncReadback` in
//!   `wasm-bridge.ts`).

use std::future::Future;

use lopsy_engine::gpu::read::Read;
use lopsy_engine::task::{Cx, Task};

/// The task of a command that hands over a [`Read`]. The read has already
/// been started: whatever it copies is the engine's state now.
pub(crate) fn read<T: 'static>(read: Read<T>) -> Task<Result<T, String>> {
    Task::new(move |_cx| read)
}

/// The task of an `async fn` command.
pub(crate) fn task<T, F: Future<Output = T> + 'static>(command: impl FnOnce(Cx) -> F) -> Task<T> {
    Task::new(command)
}

/// Run a task to its result. Every WebGL read is answered when it returns,
/// so one poll finishes it.
#[cfg(not(feature = "wgpu"))]
pub(crate) fn finish<T>(engine: &mut lopsy_engine::engine::EngineInner, mut task: Task<Result<T, String>>) -> Result<T, String> {
    match task.poll(engine) {
        std::task::Poll::Ready(result) => result,
        std::task::Poll::Pending => Err("A readback did not answer at once".to_string()),
    }
}

pub(crate) use later::{start, Tasks};

mod later {
    use std::collections::HashMap;
    use std::task::Poll;

    use lopsy_engine::engine::EngineInner;
    use lopsy_engine::task::Task;
    use wasm_bindgen::prelude::*;

    /// A command's result as the value its export would have returned.
    pub(crate) trait IntoJs {
        fn into_js(self) -> JsValue;
    }

    impl IntoJs for () {
        fn into_js(self) -> JsValue {
            JsValue::UNDEFINED
        }
    }

    impl IntoJs for Vec<u8> {
        fn into_js(self) -> JsValue {
            js_sys::Uint8Array::from(self.as_slice()).into()
        }
    }

    impl IntoJs for Vec<f32> {
        fn into_js(self) -> JsValue {
            js_sys::Float32Array::from(self.as_slice()).into()
        }
    }

    impl IntoJs for Vec<u32> {
        fn into_js(self) -> JsValue {
            js_sys::Uint32Array::from(self.as_slice()).into()
        }
    }

    impl IntoJs for Vec<i32> {
        fn into_js(self) -> JsValue {
            js_sys::Int32Array::from(self.as_slice()).into()
        }
    }

    impl<T: IntoJs> IntoJs for Option<T> {
        fn into_js(self) -> JsValue {
            self.map_or(JsValue::UNDEFINED, IntoJs::into_js)
        }
    }

    type Outcome = Result<JsValue, JsValue>;

    /// The commands of one engine that are waiting for a read.
    #[derive(Default)]
    pub(crate) struct Tasks {
        waiting: HashMap<u32, Task<Outcome>>,
        next_id: u32,
    }

    impl Tasks {
        /// Poll `task`. Its value if it finished; otherwise it is kept and
        /// the answer is the object JS waits on.
        fn drive(&mut self, engine: &mut EngineInner, mut task: Task<Outcome>) -> Outcome {
            match task.poll(engine) {
                Poll::Ready(outcome) => outcome,
                Poll::Pending => {
                    let ready = lopsy_engine::gpu::take_waiting_on()
                        .ok_or_else(|| JsError::new("A command is waiting, but not for a readback"))?;
                    let id = self.next_id;
                    self.next_id = self.next_id.wrapping_add(1);
                    self.waiting.insert(id, task);
                    let pending = js_sys::Object::new();
                    js_sys::Reflect::set(&pending, &"lopsyTask".into(), &id.into())?;
                    js_sys::Reflect::set(&pending, &"ready".into(), &ready)?;
                    Ok(pending.into())
                }
            }
        }

        pub(crate) fn resume(&mut self, engine: &mut EngineInner, id: u32) -> Outcome {
            let task = self.waiting.remove(&id).ok_or_else(|| JsError::new("No such readback task"))?;
            self.drive(engine, task)
        }
    }

    /// Start a task on the engine and answer as [`Tasks::drive`] does.
    pub(crate) fn start<T: IntoJs + 'static>(engine: &mut crate::Engine, task: Task<Result<T, String>>) -> Outcome {
        let task = task.map(|result| result.map(IntoJs::into_js).map_err(|e| JsValue::from(JsError::new(&e))));
        engine.tasks.drive(&mut engine.inner, task)
    }
}

/// Declares an export that reads pixels back, once for both backends. The
/// body runs with the named engine bound to `&mut EngineInner` and
/// evaluates to a [`Task`]: `read(..)` of a command that hands over a
/// `Read`, or `task(|cx| ..)` of an `async fn` command.
///
/// `-> Result<T>` throws the task's error; `-> T` answers `T::default()`
/// for a task that failed.
macro_rules! readback_export {
    (
        $(#[$meta:meta])*
        pub fn $name:ident($engine:ident $(, $arg:ident : $ty:ty)* $(,)?) -> Result<$ok:ty> $start:block
    ) => {
        #[cfg(not(feature = "wgpu"))]
        $(#[$meta])*
        pub fn $name($engine: &mut $crate::Engine $(, $arg: $ty)*) -> Result<$ok, wasm_bindgen::JsError> {
            let task: lopsy_engine::task::Task<Result<$ok, String>> = {
                let $engine = &mut $engine.inner;
                // An `async fn` command reaches the engine through its `Cx`.
                let _ = &$engine;
                $start
            };
            $crate::readback::finish(&mut $engine.inner, task).map_err(|e| wasm_bindgen::JsError::new(&e))
        }

        #[cfg(feature = "wgpu")]
        $(#[$meta])*
        pub fn $name($engine: &mut $crate::Engine $(, $arg: $ty)*) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
            let task: lopsy_engine::task::Task<Result<$ok, String>> = {
                let $engine = &mut $engine.inner;
                // An `async fn` command reaches the engine through its `Cx`.
                let _ = &$engine;
                $start
            };
            $crate::readback::start($engine, task)
        }
    };
    (
        $(#[$meta:meta])*
        pub fn $name:ident($engine:ident $(, $arg:ident : $ty:ty)* $(,)?) -> $ok:ty $start:block
    ) => {
        #[cfg(not(feature = "wgpu"))]
        $(#[$meta])*
        pub fn $name($engine: &mut $crate::Engine $(, $arg: $ty)*) -> $ok {
            let task: lopsy_engine::task::Task<Result<$ok, String>> = {
                let $engine = &mut $engine.inner;
                // An `async fn` command reaches the engine through its `Cx`.
                let _ = &$engine;
                $start
            };
            $crate::readback::finish(&mut $engine.inner, task).unwrap_or_default()
        }

        #[cfg(feature = "wgpu")]
        $(#[$meta])*
        pub fn $name($engine: &mut $crate::Engine $(, $arg: $ty)*) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
            let task: lopsy_engine::task::Task<Result<$ok, String>> = {
                let $engine = &mut $engine.inner;
                // An `async fn` command reaches the engine through its `Cx`.
                let _ = &$engine;
                $start
            };
            $crate::readback::start($engine, task.map(|result| Ok(result.unwrap_or_default())))
        }
    };
}
pub(crate) use readback_export;

/// Declares an export whose read may answer later on both backends: on
/// WebGL the command runs inside `gpu::deferred`, so its read waits for the
/// GPU to catch up instead of blocking on it (#1767). For reads that change
/// nothing when they land (thumbnails) and for the lazy mask read; the
/// command must do nothing with the pixels inside the engine. JS wraps it
/// in `asyncReadback` like any other readback. A task that fails answers
/// `T::default()`.
macro_rules! deferred_readback_export {
    (
        $(#[$meta:meta])*
        pub fn $name:ident($engine:ident $(, $arg:ident : $ty:ty)* $(,)?) -> $ok:ty $start:block
    ) => {
        $(#[$meta])*
        pub fn $name($engine: &mut $crate::Engine $(, $arg: $ty)*) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue> {
            let task: lopsy_engine::task::Task<Result<$ok, String>> = {
                let $engine = &mut $engine.inner;
                lopsy_engine::gpu::deferred(|| $start)
            };
            $crate::readback::start($engine, task.map(|result| Ok(result.unwrap_or_default())))
        }
    };
}
pub(crate) use deferred_readback_export;
