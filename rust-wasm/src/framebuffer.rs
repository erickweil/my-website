/// Buffer de pixels RGBA para renderização via `putImageData` no JS.
pub struct Framebuffer<'a> {
    /// `RGBA, width*height*4 bytes`
    data: &'a mut [u8],
    pub width: usize,
    pub height: usize,
}

/// Cor RGBA empacotada.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Color {
    pub const fn rgba(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }
    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self::rgba(r, g, b, 255)
    }

    pub const fn from_hsl(h: f32, s: f32, l: f32) -> Self {
        let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
        let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
        let m = l - c / 2.0;

        let (r1, g1, b1) = if h < 60.0 {
            (c, x, 0.0)
        } else if h < 120.0 {
            (x, c, 0.0)
        } else if h < 180.0 {
            (0.0, c, x)
        } else if h < 240.0 {
            (0.0, x, c)
        } else if h < 300.0 {
            (x, 0.0, c)
        } else {
            (c, 0.0, x)
        };

        Self::rgba(
            ((r1 + m) * 255.0).round() as u8,
            ((g1 + m) * 255.0).round() as u8,
            ((b1 + m) * 255.0).round() as u8,
            255,
        )
    }
}

impl<'a> Framebuffer<'a> {
    /// Cria um framebuffer com todas as células transparentes.
    pub fn new(data: &'a mut [u8], width: usize, height: usize) -> Self {
        Self { data, width, height }
    }

    /// Preenche todo o buffer com a cor fornecida.
    pub fn clear(&mut self, color: Color) {
        for pixel in self.data.chunks_exact_mut(4) {
            pixel[0] = color.r;
            pixel[1] = color.g;
            pixel[2] = color.b;
            pixel[3] = color.a;
        }
    }

    /// Escreve um pixel em (x, y). Ignora silenciosamente se fora dos limites.
    #[inline]
    pub fn set_pixel(&mut self, x: usize, y: usize, color: Color) {
        if x >= self.width || y >= self.height {
            return;
        }
        let idx = (y * self.width + x) * 4;
        self.data[idx]     = color.r;
        self.data[idx + 1] = color.g;
        self.data[idx + 2] = color.b;
        self.data[idx + 3] = color.a;
    }

    /// Lê a cor de um pixel em (x, y).
    #[inline]
    pub fn get_pixel(&self, x: usize, y: usize) -> Option<Color> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let idx = (y * self.width + x) * 4;
        Some(Color::rgba(
            self.data[idx],
            self.data[idx + 1],
            self.data[idx + 2],
            self.data[idx + 3],
        ))
    }

    /// Retorna o tamanho em bytes do buffer.
    #[inline]
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Retorna `true` se o buffer está vazio.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}
