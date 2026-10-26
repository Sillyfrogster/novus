use std::sync::{Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

/// Locks a mutex and recovers the guard after a panic. Only for state that stays valid after a panic, such as the database connection.
pub(crate) fn lock_recovering<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Read-locks an RwLock and recovers after a panic. Only for state that stays valid after a panic, such as the content gate.
pub(crate) fn read_recovering<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

/// Write-locks an RwLock and recovers after a panic. Only for state that stays valid after a panic, such as the content gate and the publication registry.
pub(crate) fn write_recovering<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::lock_recovering;

    #[test]
    fn lock_helper_recovers_from_poison() {
        let mutex = Mutex::new(41);
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                let _guard = mutex.lock().unwrap();
                panic!("simulated panic while the lock is held");
            });
            assert!(handle.join().is_err());
        });

        assert!(mutex.is_poisoned());
        assert_eq!(*lock_recovering(&mutex), 41);
    }
}
