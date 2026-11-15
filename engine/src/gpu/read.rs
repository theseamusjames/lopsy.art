//! A readback: pixels the GPU hands over when it has them.
//!
//! WebGL answers a read before the call returns. WebGPU in the browser
//! cannot: the bytes arrive after the page has gone round its event loop.
//! A [`Read`] is the same value for both, a future that a WebGL read
//! completes at once, so a command is written once and waits only where
//! the backend makes it.

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

/// Pixels being read back, or the reason they could not be.
pub struct Read<T> {
    state: State<T>,
}

enum State<T> {
    Ready(Option<Result<T, String>>),
    Later(Pin<Box<dyn Future<Output = Result<T, String>>>>),
}

// Nothing in a `Read` is pinned in place: the future it may hold is boxed.
impl<T> Unpin for Read<T> {}

impl<T: 'static> Read<T> {
    /// A read that has its answer.
    pub fn ready(result: Result<T, String>) -> Self {
        Self { state: State::Ready(Some(result)) }
    }

    /// A read that could not be started.
    pub fn failed(message: impl Into<String>) -> Self {
        Self::ready(Err(message.into()))
    }

    /// A read the backend answers later.
    pub fn later(future: impl Future<Output = Result<T, String>> + 'static) -> Self {
        Self { state: State::Later(Box::pin(future)) }
    }

    /// The same read with `f` applied to its pixels. On a read that is
    /// already answered, `f` runs now.
    pub fn map<U: 'static>(self, f: impl FnOnce(T) -> U + 'static) -> Read<U> {
        self.and_then(|value| Ok(f(value)))
    }

    /// The same read with `f` applied to its pixels, where `f` can fail.
    pub fn and_then<U: 'static>(self, f: impl FnOnce(T) -> Result<U, String> + 'static) -> Read<U> {
        match self.state {
            State::Ready(result) => Read::ready(result.unwrap_or_else(|| Err(TAKEN.into())).and_then(f)),
            State::Later(future) => Read::later(async move { future.await.and_then(f) }),
        }
    }

    /// The same read, with `fallback` as its pixels if it fails.
    pub fn or(self, fallback: T) -> Read<T> {
        match self.state {
            State::Ready(result) => Read::ready(Ok(result.and_then(Result::ok).unwrap_or(fallback))),
            State::Later(future) => Read::later(async move { Ok(future.await.unwrap_or(fallback)) }),
        }
    }

    /// The answer, if the read has one already and has not handed it over.
    pub fn peek(&self) -> Option<&Result<T, String>> {
        match &self.state {
            State::Ready(result) => result.as_ref(),
            State::Later(_) => None,
        }
    }

    /// Two reads as one, both started before either is waited for.
    pub fn join<U: 'static>(self, other: Read<U>) -> Read<(T, U)> {
        match (self.state, other.state) {
            (State::Ready(a), State::Ready(b)) => {
                let both = a.zip(b).ok_or_else(|| TAKEN.to_string()).and_then(|(a, b)| Ok((a?, b?)));
                Read::ready(both)
            }
            (a, b) => {
                let (a, b) = (Read { state: a }, Read { state: b });
                Read::later(async move { Ok((a.await?, b.await?)) })
            }
        }
    }

    /// The answer of a read that has one already: every WebGL read, and a
    /// read that failed to start. `None` when the backend has yet to answer.
    pub fn now(mut self) -> Option<Result<T, String>> {
        match Pin::new(&mut self).poll(&mut Context::from_waker(Waker::noop())) {
            Poll::Ready(result) => Some(result),
            Poll::Pending => None,
        }
    }
}

const TAKEN: &str = "readback was already taken";

impl<T> Future for Read<T> {
    type Output = Result<T, String>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match &mut self.get_mut().state {
            State::Ready(result) => Poll::Ready(result.take().unwrap_or_else(|| Err(TAKEN.into()))),
            State::Later(future) => future.as_mut().poll(cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    /// A future that is pending until `gate` is set.
    fn gated(gate: Rc<Cell<bool>>, value: u8) -> Read<u8> {
        Read::later(std::future::poll_fn(move |_| if gate.get() { Poll::Ready(Ok(value)) } else { Poll::Pending }))
    }

    #[test]
    fn an_answered_read_maps_at_once() {
        let read = Read::ready(Ok(vec![1u8, 2, 3])).map(|pixels| pixels.len());
        assert_eq!(read.now(), Some(Ok(3)));
    }

    #[test]
    fn a_failed_read_skips_the_mapping_and_keeps_its_reason() {
        let read: Read<usize> = Read::<Vec<u8>>::failed("Texture not found").map(|pixels| pixels.len());
        assert_eq!(read.now(), Some(Err("Texture not found".to_string())));
        let read = Read::ready(Ok(2u8)).and_then(|_| Err::<u8, _>("too small".to_string()));
        assert_eq!(read.now(), Some(Err("too small".to_string())));
    }

    #[test]
    fn a_later_read_has_no_answer_until_the_backend_gives_one() {
        let gate = Rc::new(Cell::new(false));
        assert!(gated(gate.clone(), 7).map(|v| v + 1).now().is_none());
        gate.set(true);
        assert_eq!(gated(gate, 7).map(|v| v + 1).now(), Some(Ok(8)));
    }

    #[test]
    fn a_fallback_replaces_a_failure_and_only_an_answered_read_can_be_peeked() {
        assert_eq!(Read::<u8>::failed("gone").or(9).now(), Some(Ok(9)));
        assert_eq!(Read::ready(Ok(1u8)).or(9).now(), Some(Ok(1)));
        assert_eq!(Read::ready(Ok(1u8)).peek(), Some(&Ok(1)));
        assert!(gated(Rc::new(Cell::new(true)), 1).peek().is_none());
    }

    #[test]
    fn joined_reads_answer_together() {
        assert_eq!(Read::ready(Ok(1u8)).join(Read::ready(Ok("b"))).now(), Some(Ok((1, "b"))));
        assert_eq!(Read::ready(Ok(1u8)).join(Read::<u8>::failed("gone")).now(), Some(Err("gone".to_string())));
        let gate = Rc::new(Cell::new(false));
        let mut joined = Read::ready(Ok(1u8)).join(gated(gate.clone(), 2));
        let mut cx = Context::from_waker(Waker::noop());
        assert!(Pin::new(&mut joined).poll(&mut cx).is_pending());
        gate.set(true);
        assert_eq!(Pin::new(&mut joined).poll(&mut cx), Poll::Ready(Ok((1, 2))));
    }
}
