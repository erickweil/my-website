/// Gera um struct wrapper concreto com `#[wasm_bindgen]` para expor um `GeneticAlgorithm<P>` ao JS.
///
/// # Sintaxe
/// ```rust,ignore
/// ga_runner! {
///     /// Doc opcional para o runner
///     MyProblemRunner,                          // nome do struct exportado
///     problem: MyProblem,                       // tipo que implementa GAProblem
///     new(arg1: Type1, arg2: Type2) => MyProblem::new(arg1, arg2),
///     extra {
///         // métodos adicionais com #[wasm_bindgen] — opcionais
///         pub fn foo(&self) -> usize { ... }
///     }
/// }
/// ```
///
/// O macro gera automaticamente:
/// - `new(args..., config: GAConfig) -> Self`
/// - `run(&mut self, generations: usize)`
/// - `update_config(&mut self, config: GAConfig)`
/// - `get_info(&self) -> Result<JsValue, serde_wasm_bindgen::Error>`
#[macro_export]
macro_rules! ga_runner {
    (
        $(#[$meta:meta])*
        $runner:ident,
        problem: $problem:ty,
        new($($arg:ident : $arg_ty:ty),* $(,)?) => $problem_new:expr
        $(, extra { $($extra:tt)* })?
        $(,)?
    ) => {
        $(#[$meta])*
        #[wasm_bindgen::prelude::wasm_bindgen]
        pub struct $runner {
            ga: $crate::genetic::ga::GeneticAlgorithm<$problem>,
        }

        #[wasm_bindgen::prelude::wasm_bindgen]
        impl $runner {
            #[wasm_bindgen(constructor)]
            pub fn new($($arg: $arg_ty,)* config: $crate::genetic::ga::GAConfig) -> Self {
                Self {
                    ga: $crate::genetic::ga::GeneticAlgorithm::new($problem_new, config),
                }
            }

            pub fn run(&mut self, generations: usize) {
                self.ga.run(generations);
            }

            pub fn update_config(&mut self, config: $crate::genetic::ga::GAConfig) {
                self.ga.config = config;
            }

            /// Retorna metadados da execução (geração, fitness, genes, estagnação) como objeto JS.
            pub fn get_info(&self) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
                serde_wasm_bindgen::to_value(&self.ga.get_info())
            }

            $($($extra)*)?
        }
    };
}
