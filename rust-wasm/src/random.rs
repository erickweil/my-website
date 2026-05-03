// Para ser possível trocar depois se eu quiser qual biblioteca de random usar

#[inline(always)]
pub fn random_f64() -> f64 {
    fastrand::f64()    
}

#[inline(always)]
#[allow(dead_code)]
pub fn random_shuffle<T>(slice: &mut [T]) {
    fastrand::shuffle(slice);
}

#[inline(always)]
pub fn random_range(start: usize, end: usize) -> usize {
    fastrand::usize(start..end)
}
