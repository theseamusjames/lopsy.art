//! Commands that wait for the GPU.
//!
//! A command that reads pixels back and then works on them is an `async
//! fn` that takes a [`Cx`]. It reaches the engine through [`Cx::with`] and
//! awaits its [`Read`](crate::gpu::read::Read)s in between, so it never
//! holds the engine while it waits and frames keep rendering.
//!
//! A host runs one as a [`Task`]. On WebGL every read is answered before
//! it returns, so the task finishes in its first poll and [`run_now`]
//! gives the result to a caller that is not async at all. On WebGPU the
//! host keeps the task and polls it again when the read it waits on has
//! arrived.

use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use std::ptr;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use crate::engine::EngineInner;

/// A command's way to the engine while its task is being polled.
#[derive(Clone)]
pub struct Cx {
    /// The engine, for the length of one poll; null between polls.
    engine: Rc<Cell<*mut EngineInner>>,
}

impl Cx {
    /// Run `f` on the engine. Everything between two awaits that needs the
    /// engine goes in one call: the engine may have changed across an
    /// await, since other commands and frames run while a task waits.
    ///
    /// # Panics
    /// If called while no poll is in progress or from inside another
    /// `with`.
    pub fn with<R>(&self, f: impl FnOnce(&mut EngineInner) -> R) -> R {
        let engine = self.engine.replace(ptr::null_mut());
        assert!(!engine.is_null(), "a command reached for the engine outside its task's poll");
        // SAFETY: `Task::poll` stored this pointer from the `&mut
        // EngineInner` it holds for the whole poll and does not touch that
        // reference itself until the poll returns. The pointer was just
        // swapped out for null, so no other `with` can hand it out while
        // `f` runs.
        let result = f(unsafe { &mut *engine });
        self.engine.set(engine);
        result
    }
}

/// A command in progress.
pub struct Task<T> {
    cx: Cx,
    future: Pin<Box<dyn Future<Output = T>>>,
}

impl<T> Task<T> {
    /// Start `command`. Nothing runs until the first [`Task::poll`].
    pub fn new<F: Future<Output = T> + 'static>(command: impl FnOnce(Cx) -> F) -> Self {
        let cx = Cx { engine: Rc::new(Cell::new(ptr::null_mut())) };
        let future = Box::pin(command(cx.clone()));
        Self { cx, future }
    }

    /// The same command with `f` applied to its result.
    pub fn map<U>(self, f: impl FnOnce(T) -> U + 'static) -> Task<U>
    where
        T: 'static,
    {
        let future = self.future;
        Task { cx: self.cx, future: Box::pin(async move { f(future.await) }) }
    }

    /// Run the command until it finishes or waits for a read.
    pub fn poll(&mut self, engine: &mut EngineInner) -> Poll<T> {
        // Cleared on the way out even if the command panics, so the
        // pointer never outlives the borrow it came from.
        struct Lend<'a>(&'a Cell<*mut EngineInner>);
        impl Drop for Lend<'_> {
            fn drop(&mut self) {
                self.0.set(ptr::null_mut());
            }
        }
        self.cx.engine.set(engine);
        let _lend = Lend(&self.cx.engine);
        self.future.as_mut().poll(&mut Context::from_waker(Waker::noop()))
    }
}

/// Run a command to its result on a backend whose reads never wait.
///
/// # Panics
/// If the command waits. A backend that answers reads later keeps the
/// [`Task`] and polls it again instead of calling this.
pub fn run_now<T, F: Future<Output = T> + 'static>(engine: &mut EngineInner, command: impl FnOnce(Cx) -> F) -> T {
    match Task::new(command).poll(engine) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("a command waited for a read on a backend that answers reads at once"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_task_reaches_only_what_it_asks_the_cx_for() {
        // `Cx::with` hands out the engine `Task::poll` was given. A command
        // that never calls it runs without one, which is all a unit test
        // can construct.
        let cx = Cx { engine: Rc::new(Cell::new(ptr::null_mut())) };
        let outside = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cx.with(|_| ())));
        assert!(outside.is_err(), "the engine must not be reachable outside a poll");
    }

    #[test]
    fn mapping_a_task_changes_only_its_result() {
        let task = Task::new(|_cx| async { 20 }).map(|n| n + 1);
        let mut future = task.future;
        assert_eq!(future.as_mut().poll(&mut Context::from_waker(Waker::noop())), Poll::Ready(21));
    }
}
