use crate::console_log;

pub fn teste() {
    console_log!("Teste de função!");
}


#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test(unsupported = test)]
    fn it_works() {
        teste();

        assert_eq!(2 + 2, 4);
    }
}

