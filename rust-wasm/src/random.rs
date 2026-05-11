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

#[inline(always)]
pub fn random_bool() -> bool {
    fastrand::bool()
}

/// Irá produzir uma distribuição uniforme entre os números possíveis e nunca irá retornar o número "except"
/// Se o intervalo for de tamanho 1, irá retornar "start" (que é o único número possível)
#[inline(always)]
pub fn random_range_except(start: usize, end: usize, except: usize) -> usize {
    // Se o intervalo for muito pequeno, não tem como escolher um número diferente
    if end - start == 1 { 
        return start;
    }
    // Gerar um número aleatório, (-1 porque o "except" não pode ser escolhido)
    let rand = fastrand::usize(start..(end - 1));
    // Se o número aleatório for maior ou igual ao "except", precisamos adicionar 1 para pular o "except"
    // [0, 1, 2, 3, 4, 5] com except = 3 -> [0, 1, 2, 4, 5]
    if rand >= except {
        rand + 1
    } else {
        rand
    }
}