import type { Metadata } from "next";
import Link from "next/link";
import { FaGithub, FaGoogle } from "react-icons/fa";

export const metadata: Metadata = {
  description:
    "O que é o site Erick Weil, quais dados o login com o Google solicita e para quê. Página pública, sem necessidade de cadastro.",
};

const CONTACT_EMAIL = "erick.weil@ifro.edu.br";
const PRIVACY_URL = "/politica-de-privacidade.html";

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 mt-12 first:mt-0">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/40 mb-1">
          {eyebrow}
        </p>
        <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Scope({
  name,
  scope,
  children,
}: {
  name: string;
  scope: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-xl bg-foreground/[0.03] px-4 py-3">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <p className="text-xs font-mono text-foreground/45 mt-0.5 break-all">{scope}</p>
      <p className="text-sm leading-relaxed text-foreground/60 mt-1.5">{children}</p>
    </li>
  );
}

export default function Sobre() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-12 md:py-16">
      <div className="w-full max-w-3xl">

        <Link
          href="/"
          className="text-sm text-foreground/45 hover:text-foreground transition-colors"
        >
          ← Início
        </Link>

        {/* Identificação do app */}
        <header className="mt-8 mb-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Erick Weil
          </h1>
          <p className="text-xs font-mono uppercase tracking-[0.22em] text-foreground/40 mt-2">
            liewkcire.vercel.app
          </p>
          <p className="text-base md:text-lg text-foreground/55 leading-relaxed mt-4">
            Site pessoal de Erick Weil, desenvolvedor de software, com utilitários,
            simuladores e experimentos de computação que rodam direto no navegador.
          </p>
        </header>

        <Section id="o-que-e" eyebrow="Sobre" title="O que é este site">
          <div className="rounded-2xl border border-foreground/10 p-5 sm:p-6 space-y-4">
            <p className="text-sm leading-relaxed text-foreground/70">
              O site reúne ferramentas e simulações feitas para explorar conceitos de
              computação de forma visual e interativa. Todo o processamento acontece no
              seu próprio navegador, em JavaScript e WebAssembly — nada é instalado e não
              há cobrança.
            </p>
            <ul className="text-sm leading-relaxed text-foreground/60 space-y-2.5 list-disc pl-5">
              <li>
                <Link href="/toy/gerador-horario" className="font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground transition-colors">
                  Gerador de Horário
                </Link>{" "}
                — monta grades de aula a partir das restrições de professores, turmas e
                horários disponíveis.
              </li>
              <li>
                <Link href="/toy/turing" className="font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground transition-colors">
                  Máquina de Turing
                </Link>{" "}
                — simulador em que você define estados, símbolos e transições e acompanha
                a execução passo a passo.
              </li>
              <li>
                <Link href="/toy/sudoku-minado" className="font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground transition-colors">
                  Sudoku Minado
                </Link>{" "}
                — quebra-cabeça que combina as regras do sudoku com as do campo minado.
              </li>
              <li>
                <Link href="/toy/genetic" className="font-medium text-foreground/80 underline underline-offset-2 hover:text-foreground transition-colors">
                  Algoritmos Genéticos
                </Link>{" "}
                — visualização de populações de soluções evoluindo em tempo real.
              </li>
            </ul>
            <p className="text-sm leading-relaxed text-foreground/60">
              A <Link href="/" className="underline underline-offset-2 hover:text-foreground transition-colors">página inicial</Link>{" "}
              lista essas ferramentas junto com outros projetos publicados fora deste
              domínio. Tudo pode ser acessado livremente, sem cadastro e sem login.
            </p>
          </div>
        </Section>

        <Section id="login-google" eyebrow="Conta" title="Login com o Google">
          <div className="rounded-2xl border border-foreground/10 p-5 sm:p-6 space-y-6">
            <p className="text-sm leading-relaxed text-foreground/70 flex gap-3">
              <FaGoogle className="shrink-0 mt-1 text-foreground/40" size={18} />
              <span>
                As ferramentas funcionam sem nenhum cadastro. O login com a Conta Google é{" "}
                <strong className="text-foreground">opcional</strong> e serve para um único
                propósito: criar uma conta que guarde o seu trabalho — como as grades
                montadas no Gerador de Horário ou as máquinas definidas no simulador de
                Turing — para que você possa retomá-lo depois, inclusive em outro
                dispositivo. Sem o login, esses dados ficam apenas no navegador atual.
              </span>
            </p>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Quais dados são solicitados, e por quê
              </h3>
              <ul className="space-y-3">
                <Scope name="Identificador da sua conta" scope="openid">
                  Vincula o trabalho que você salvar à sua conta, sem que você precise
                  criar e memorizar mais uma senha.
                </Scope>
                <Scope name="Nome e foto de perfil" scope=".../auth/userinfo.profile">
                  Mostram, dentro do site, com qual conta você está conectado.
                </Scope>
                <Scope name="Endereço de e-mail" scope=".../auth/userinfo.email">
                  Identifica a sua conta de forma única e permite responder a pedidos de
                  suporte ou de exclusão de dados feitos por você.
                </Scope>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">O que não é feito</h3>
              <ul className="text-sm leading-relaxed text-foreground/60 space-y-1.5 list-disc pl-5">
                <li>
                  Nenhum outro dado da sua Conta Google é acessado — nem Gmail, Drive,
                  Agenda, Contatos ou Fotos.
                </li>
                <li>Seus dados não são vendidos, alugados nem usados para publicidade.</li>
                <li>Não há rastreamento entre sites nem cookies de anúncios.</li>
                <li>Seus dados não são usados para treinar modelos de inteligência artificial.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Como revogar o acesso</h3>
              <p className="text-sm leading-relaxed text-foreground/60">
                A qualquer momento, em{" "}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Apps conectados à sua Conta Google
                </a>
                . Para apagar também a conta e os dados guardados aqui, basta escrever para{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </div>

            <p className="text-xs leading-relaxed text-foreground/45 border-t border-foreground/10 pt-4">
              O uso das informações recebidas das APIs do Google segue a{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground/70 transition-colors"
              >
                Política de Dados do Usuário dos Serviços de API do Google
              </a>
              , incluindo os requisitos de Uso Limitado. Os detalhes completos estão na{" "}
              <a
                href={PRIVACY_URL}
                className="underline underline-offset-2 hover:text-foreground/70 transition-colors"
              >
                Política de Privacidade
              </a>
              .
            </p>
          </div>
        </Section>

        <Section id="contato" eyebrow="Responsável" title="Quem mantém o site">
          <div className="rounded-2xl border border-foreground/10 p-5 sm:p-6 space-y-3 text-sm leading-relaxed text-foreground/60">
            <p>
              <strong className="text-foreground">Erick Weil</strong> — desenvolvedor de
              software, Rondônia, Brasil. Responsável pelo site e pelo tratamento dos dados
              descritos acima.
            </p>
            <p className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                {CONTACT_EMAIL}
              </a>
              <a
                href="https://github.com/erickweil"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 hover:text-foreground transition-colors"
              >
                <FaGithub size={18} /> github.com/erickweil
              </a>
            </p>
          </div>
        </Section>

        <footer className="mt-16 pt-6 border-t border-foreground/10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-foreground/50">
            <p>© 2026 Erick Weil · liewkcire.vercel.app</p>
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a href={PRIVACY_URL} className="hover:text-foreground transition-colors">
                Política de Privacidade
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground transition-colors">
                Contato
              </a>
              <Link href="/" className="hover:text-foreground transition-colors">
                Início
              </Link>
            </nav>
          </div>
        </footer>

      </div>
    </main>
  );
}
